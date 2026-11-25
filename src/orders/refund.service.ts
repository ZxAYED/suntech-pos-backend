import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
  Role,
  ShiftStatus,
  StockTransactionType,
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { getDhakaDayRange } from '../common/utils/timezone.util';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { lineTotal, sumMoney } from './money';
import { readAtomicReplay, type AtomicReceiptContext, type AtomicStoredResponse } from '../common/interceptors/atomic-idempotency';
import { toStoredJson } from '../common/interceptors/to-stored-json';
import { sanitizeResponseData } from '../common/interceptors/sanitize-response-data';
import { RefundStatus, refundStatus } from './refund-status';

const refundItemSelect = {
  id: true,
  orderLineId: true,
  quantity: true,
  refundAmount: true,
} satisfies Prisma.RefundItemSelect;

const refundSelect = {
  id: true,
  orderId: true,
  processedById: true,
  payoutShiftId: true,
  totalRefund: true,
  reason: true,
  createdAt: true,
  items: { select: refundItemSelect },
} satisfies Prisma.RefundSelect;

type StoredRefund = Prisma.RefundGetPayload<{ select: typeof refundSelect }>;

export type PresentedRefund = StoredRefund & {
  refundStatus: RefundStatus;
};

const OVER_REFUND = 'Refund quantity exceeds the remaining quantity';

@Injectable()
export class RefundService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: AccessTokenPayload,
    orderId: string,
    dto: CreateRefundDto,
  ): Promise<PresentedRefund> {
    const businessId = requireBusinessId(actor, dto.businessId);
    if (actor.role === Role.CASHIER && !actor.locationId) {
      throw new ForbiddenException(
        'Cashier account must be assigned to an active business and branch location',
      );
    }

    try {
      return await this.prisma.$transaction(
        (tx) =>
          this.createWithin(
            tx,
            actor.sub,
            businessId,
            orderId,
            dto,
            actor.role === Role.CASHIER ? actor.locationId : undefined,
            actor.role,
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException('Refund could not be completed. Retry.');
      }

      throw error;
    }
  }

  /** Keep the original route/key/envelope. The refund, drawer/stock writes and
   * successful HTTP result are committed together. Legacy pending keys remain
   * locked because their pre-upgrade outcomes cannot be inferred. */
  async createAtomic(
    actor: AccessTokenPayload,
    orderId: string,
    dto: CreateRefundDto,
    context: AtomicReceiptContext,
  ): Promise<AtomicStoredResponse> {
    const businessId = requireBusinessId(actor, dto.businessId);
    if (actor.role === Role.CASHIER && !actor.locationId) {
      throw new ForbiddenException('Cashier account must be assigned to an active business and branch location');
    }
    const locationId = actor.role === Role.CASHIER ? actor.locationId : undefined;
    const where = { scopeId_key: { scopeId: context.scopeId, key: context.key } };
    // Check current resource access even for a replay; an old successful response
    // is not permission to access a different branch or a transferred business.
    const checkScope = async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.findFirst({ where: {
        id: actor.sub, role: actor.role, status: AccountStatus.ACTIVE, deletedAt: null,
        ...(actor.role === Role.CASHIER ? { businessId, locationId, isLoggedIn: true, sessionId: actor.sessionId ?? '__invalid_session__' } : {}),
      }, select: { id: true } });
      if (!user) throw new ForbiddenException('Refund authority is no longer active');
      const order = await tx.order.findFirst({ where: {
        id: orderId, location: { businessId, deletedAt: null, business: { deletedAt: null, ...(actor.role === Role.ADMIN ? { ownerId: actor.sub } : {}) } },
        ...(locationId ? { locationId } : {}),
      }, select: { id: true } });
      if (!order) throw new NotFoundException('Order not found');
    };
    try {
      return await this.prisma.$transaction(async tx => {
        await checkScope(tx);
        const existing = await tx.idempotencyRecord.findUnique({ where });
        if (existing) return readAtomicReplay(existing, context);
        await tx.idempotencyRecord.create({ data: {
          scopeId: context.scopeId, key: context.key, path: context.path,
          requestHash: context.requestHash, statusCode: 0,
          responseBody: { pending: true }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        } });
        const refund = await this.createWithin(tx, actor.sub, businessId, orderId, dto, locationId, actor.role);
        const responseBody = toStoredJson({ success: true, message: context.message, data: sanitizeResponseData(refund, actor.role === Role.CASHIER), timestamp: new Date().toISOString() });
        const saved = await tx.idempotencyRecord.update({ where, data: { statusCode: context.statusCode, responseBody } });
        return { statusCode: saved.statusCode, responseBody: saved.responseBody };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(cause.code)) {
        // Transaction rolled back. A concurrent winner may now have a durable
        // receipt. Re-read under the original scope, never create another key.
        const replay = await this.prisma.$transaction(async tx => {
          await checkScope(tx);
          const row = await tx.idempotencyRecord.findUnique({ where });
          return row ? readAtomicReplay(row, context) : null;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (replay) return replay;
        throw new ConflictException({ code: 'REFUND_RETRY_SAME_ID', message: 'Concurrent refund processing. Retry the original refund without paying again.' });
      }
      throw cause;
    }
  }

  async createWithin(
    tx: Prisma.TransactionClient,
    actorId: string,
    businessId: string,
    orderId: string,
    dto: CreateRefundDto,
    cashierLocationId?: string | null,
    actorRole?: Role,
    options?: { explicitShift: boolean; occurredAt: Date },
  ): Promise<PresentedRefund> {
    const existingOrder = tx.order?.findUnique
      ? await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            locationId: true,
            location: { select: { businessId: true } },
          },
        })
      : await tx.order.findFirst({
          where: { id: orderId },
          select: {
            id: true,
            locationId: true,
            location: { select: { businessId: true } },
          },
        });

    if (!existingOrder) {
      throw new NotFoundException('Order not found');
    }

    if (
      existingOrder.location?.businessId &&
      existingOrder.location.businessId !== businessId
    ) {
      throw new BadRequestException(
        'Order does not belong to the specified business',
      );
    }

    if (
      cashierLocationId &&
      existingOrder.locationId &&
      existingOrder.locationId !== cashierLocationId
    ) {
      throw new ForbiddenException(
        'Order does not belong to your assigned branch location',
      );
    }

    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        location: { businessId },
        ...(cashierLocationId ? { locationId: cashierLocationId } : {}),
      },
      select: {
        id: true,
        locationId: true,
        invoiceNumber: true,
        receiptNumber: true,
        shiftId: true,
        status: true,
        paymentMethod: true,
        lines: {
          select: {
            id: true,
            variantId: true,
            unitPrice: true,
            quantity: true,
            refundItems: { select: { quantity: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.PENDING) {
      throw new BadRequestException('Cannot refund an unpaid order');
    }

    const orderLines =
      order.lines ??
      (
        order as unknown as {
          items?: Array<{
            id: string;
            variantId?: string | null;
            price?: number;
            unitPrice?: number;
            quantity: number;
            refundItems: Array<{ quantity: number }>;
          }>;
        }
      ).items?.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        unitPrice: item.unitPrice ?? item.price ?? 0,
        quantity: item.quantity,
        refundItems: item.refundItems ?? [],
      })) ??
      [];

    const itemsById = new Map(orderLines.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const requested = [];

    for (const line of dto.items) {
      if (seen.has(line.orderItemId)) {
        throw new BadRequestException('Each order item can appear only once');
      }

      seen.add(line.orderItemId);
      const item = itemsById.get(line.orderItemId);

      if (!item) {
        throw new NotFoundException('Order item not found');
      }

      const alreadyRefunded = item.refundItems.reduce(
        (total, refundItem) => total + refundItem.quantity,
        0,
      );

      if (line.quantity > item.quantity - alreadyRefunded) {
        throw new ConflictException(OVER_REFUND);
      }

      requested.push({
        orderItemId: item.id,
        variantId: item.variantId,
        quantity: line.quantity,
        refundAmount: lineTotal(item.unitPrice, line.quantity),
        refundedAfter: alreadyRefunded + line.quantity,
        purchased: item.quantity,
      });
    }

    for (const line of requested) {
      if (!line.variantId) {
        continue;
      }

      const restored = await tx.variant.updateMany({
        where: { id: line.variantId, businessId },
        data: { stock: { increment: line.quantity } },
      });

      if (restored.count === 0) {
        continue;
      }

      if ((tx as any).locationStock && order.locationId) {
        await (tx as any).locationStock.upsert({
          where: {
            locationId_variantId: {
              locationId: order.locationId,
              variantId: line.variantId,
            },
          },
          update: { stock: { increment: line.quantity } },
          create: {
            businessId,
            locationId: order.locationId,
            variantId: line.variantId,
            stock: line.quantity,
          },
        });
      }

      await tx.stockTransaction.create({
        data: {
          variantId: line.variantId,
          locationId: order.locationId ?? null,
          type: StockTransactionType.REFUND,
          quantity: line.quantity,
          notes: order.invoiceNumber ?? order.receiptNumber ?? undefined,
        },
      });
    }

    let payoutShiftId: string | null = null;
    if (dto.payoutShiftId) {
      if (tx.shiftSession?.findFirst) {
        const isCashier = actorRole === Role.CASHIER || (actorRole === undefined && Boolean(cashierLocationId));
        const specifiedShift = await tx.shiftSession.findFirst({
          where: {
            id: dto.payoutShiftId,
            businessId,
            ...(order.locationId ? { locationId: order.locationId } : {}),
            status: ShiftStatus.OPEN,
            ...(options ? { openedAt: { lte: options.occurredAt } } : {}),
          },
          select: { id: true, cashierId: true },
        });
        if (!specifiedShift) {
          throw new BadRequestException(
            'Specified payout shift is not open or not in the same business and branch',
          );
        }
        if (isCashier && specifiedShift.cashierId !== actorId) {
          throw new ForbiddenException(
            'Cashiers can only payout refunds from their own shift',
          );
        }
        payoutShiftId = specifiedShift.id;
      }
    } else if (!options?.explicitShift && order.locationId && tx.shiftSession?.findFirst) {
      const { start: startOfToday, nextStart: nextDayStart } =
        getDhakaDayRange();
      const activeShift = await tx.shiftSession.findFirst({
        where: {
          locationId: order.locationId,
          businessId,
          cashierId: actorId,
          status: ShiftStatus.OPEN,
          openedAt: { gte: startOfToday, lt: nextDayStart },
        },
        select: { id: true },
      });
      if (activeShift) {
        payoutShiftId = activeShift.id;
      }
    }

    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        ...(options ? { createdAt: options.occurredAt } : {}),
        processedById: actorId,
        totalRefund: sumMoney(requested.map((line) => line.refundAmount)),
        reason: dto.reason?.trim() || null,
        payoutShiftId: payoutShiftId ?? null,
        items: {
          create: requested.map((line) => ({
            orderLineId: line.orderItemId,
            quantity: line.quantity,
            refundAmount: line.refundAmount,
          })),
        },
      },
      select: refundSelect,
    });
    const refundedByItem = new Map(
      requested.map((line) => [line.orderItemId, line.refundedAfter]),
    );
    const status = refundStatus(
      orderLines.map((item) => ({
        quantity: item.quantity,
        refunded:
          refundedByItem.get(item.id) ??
          item.refundItems.reduce(
            (total, refundItem) => total + refundItem.quantity,
            0,
          ),
      })),
    );

    if (status === 'REFUNDED' && tx.order?.update) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REFUNDED },
      });
    }

    if (payoutShiftId && order.paymentMethod === PaymentMethod.COD) {
      if (tx.shiftSession?.updateMany) {
        const updateResult = await tx.shiftSession.updateMany({
          where: { id: payoutShiftId, status: ShiftStatus.OPEN },
          data: { cashCollected: { decrement: refund.totalRefund } },
        });
        if (updateResult && updateResult.count === 0) {
          throw new ConflictException(
            'Register shift closed during refund processing. Please retry with an open shift.',
          );
        }
      }
    }

    return {
      ...refund,
      refundStatus: status ?? 'PARTIALLY_REFUNDED',
    };
  }
}
