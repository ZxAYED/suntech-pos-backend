import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  Prisma,
  Role,
  ShiftStatus,
  StockTransactionType,
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { lineTotal, sumMoney } from './money';
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

  async createWithin(
    tx: Prisma.TransactionClient,
    actorId: string,
    businessId: string,
    orderId: string,
    dto: CreateRefundDto,
    cashierLocationId?: string | null,
    actorRole?: Role,
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
        const isCashier = Boolean(cashierLocationId) || actorRole === Role.CASHIER;
        const specifiedShift = await tx.shiftSession.findFirst({
          where: {
            id: dto.payoutShiftId,
            businessId,
            ...(order.locationId ? { locationId: order.locationId } : {}),
            status: ShiftStatus.OPEN,
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
    } else if (order.locationId && tx.shiftSession?.findFirst) {
      const activeShift = await tx.shiftSession.findFirst({
        where: {
          locationId: order.locationId,
          businessId,
          cashierId: actorId,
          status: ShiftStatus.OPEN,
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
