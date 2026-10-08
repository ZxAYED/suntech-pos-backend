import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockTransactionType } from '@prisma/client';
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
    admin: AccessTokenPayload,
    orderId: string,
    dto: CreateRefundDto,
  ): Promise<PresentedRefund> {
    const businessId = requireBusinessId(admin);

    try {
      return await this.prisma.$transaction(
        (tx) => this.createWithin(tx, admin.sub, businessId, orderId, dto),
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
    adminId: string,
    businessId: string,
    orderId: string,
    dto: CreateRefundDto,
  ): Promise<PresentedRefund> {
    const order = await tx.order.findFirst({
      where: { id: orderId, cashier: { businessId } },
      select: {
        id: true,
        invoiceNumber: true,
        receiptNumber: true,
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
      (order as unknown as { items?: Array<{ id: string; variantId?: string | null; price?: number; unitPrice?: number; quantity: number; refundItems: Array<{ quantity: number }> }> }).items?.map((item) => ({
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

      await tx.stockTransaction.create({
        data: {
          variantId: line.variantId,
          type: StockTransactionType.REFUND,
          quantity: line.quantity,
          notes: order.invoiceNumber ?? order.receiptNumber ?? undefined,
        },
      });
    }

    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        processedById: adminId,
        totalRefund: sumMoney(requested.map((line) => line.refundAmount)),
        reason: dto.reason?.trim() || null,
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

    return {
      ...refund,
      refundStatus: status ?? 'PARTIALLY_REFUNDED',
    };
  }
}
