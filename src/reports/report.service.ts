import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionLogQueryDto } from './dto/transaction-log.query';

export interface CashierDashboard {
  myDailyRevenue: number;
  myDailyUnitsSold: number;
  myMonthlyRevenue: number;
}

export interface StaffLeaderboardEntry {
  cashierId: string;
  fullName: string;
  publicId: string | null;
  revenue: number;
}

export interface AdminDashboard {
  globalDailyRevenue: number;
  globalRolling30DayRevenue: number;
  staffLeaderboard: StaffLeaderboardEntry[];
}

const transactionLineSelect = {
  id: true,
  variantId: true,
  productName: true,
  variantName: true,
  unitPrice: true,
  quantity: true,
  subtotal: true,
} satisfies Prisma.OrderLineSelect;

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  dashboard(
    actor: AccessTokenPayload,
  ): Promise<CashierDashboard | AdminDashboard> {
    const businessId = requireBusinessId(actor);

    if (actor.role === Role.CASHIER) {
      return this.cashierDashboard(businessId, actor.sub);
    }

    if (actor.role === Role.ADMIN) {
      return this.adminDashboard(businessId);
    }

    throw new ForbiddenException(
      'You do not have permission to perform this action',
    );
  }

  async transactions(actor: AccessTokenPayload, query: TransactionLogQueryDto) {
    const businessId = requireBusinessId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { cashier: { businessId } };
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          receiptNumber: true,
          orderType: true,
          status: true,
          customerName: true,
          customerPhone: true,
          customerNumber: true,
          totalAmount: true,
          subtotal: true,
          tenderedAmount: true,
          changeDue: true,
          paymentMethod: true,
          createdAt: true,
          cashier: {
            select: { id: true, fullName: true, publicId: true },
          },
          lines: { select: transactionLineSelect },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items = orders.map((order) => ({
      id: order.id,
      invoiceNumber: order.invoiceNumber,
      receiptNumber: order.invoiceNumber ?? order.receiptNumber,
      orderType: order.orderType,
      status: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerNumber: order.customerNumber ?? order.customerPhone,
      totalAmount: order.totalAmount,
      subtotal: order.subtotal,
      tenderedAmount: order.tenderedAmount,
      changeDue: order.changeDue,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
      cashier: order.cashier,
      lines: order.lines,
      items: order.lines.map((line) => ({
        id: line.id,
        variantId: line.variantId,
        customItemName: line.variantId ? null : (line.variantName ?? line.productName),
        price: line.unitPrice,
        quantity: line.quantity,
        subtotal: line.subtotal,
      })),
    }));

    return { items, page, limit, total };
  }

  private async cashierDashboard(
    businessId: string,
    cashierId: string,
  ): Promise<CashierDashboard> {
    const today = utcDay();
    const month = utcMonth();
    const mine = { cashierId, cashier: { businessId } };

    const [myDailyRevenue, myMonthlyRevenue, myDailyUnitsSold] =
      await Promise.all([
        this.netRevenue({ ...mine, createdAt: today }),
        this.netRevenue({ ...mine, createdAt: month }),
        this.unitsSold({ ...mine, createdAt: today }),
      ]);

    return { myDailyRevenue, myDailyUnitsSold, myMonthlyRevenue };
  }

  private async adminDashboard(businessId: string): Promise<AdminDashboard> {
    const today = utcDay();
    const rolling = {
      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lt: new Date(),
    };
    const month = utcMonth();
    const business = { cashier: { businessId } };
    const [globalDailyRevenue, globalRolling30DayRevenue, staffLeaderboard] =
      await Promise.all([
        this.netRevenue({ ...business, createdAt: today }),
        this.netRevenue({ ...business, createdAt: rolling }),
        this.leaderboard(businessId, month),
      ]);

    return {
      globalDailyRevenue,
      globalRolling30DayRevenue,
      staffLeaderboard,
    };
  }

  private async leaderboard(
    businessId: string,
    createdAt: { gte: Date; lt: Date },
  ): Promise<StaffLeaderboardEntry[]> {
    const where = {
      createdAt,
      cashier: { businessId, role: Role.CASHIER, deletedAt: null },
    };
    const [grouped, refunds, cashiers] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['cashierId'],
        where,
        _sum: { totalAmount: true },
      }),
      this.prisma.refund.findMany({
        where: { order: where },
        select: {
          totalRefund: true,
          order: { select: { cashierId: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { businessId, role: Role.CASHIER, deletedAt: null },
        select: { id: true, fullName: true, publicId: true },
      }),
    ]);
    const revenue = new Map(
      grouped.map((row) => [row.cashierId, row._sum.totalAmount ?? 0]),
    );

    for (const refund of refunds) {
      const current = revenue.get(refund.order.cashierId);

      if (current === undefined) {
        continue;
      }

      revenue.set(refund.order.cashierId, current - refund.totalRefund);
    }

    const profiles = new Map(cashiers.map((cashier) => [cashier.id, cashier]));

    return [...revenue.entries()]
      .flatMap(([cashierId, total]) => {
        const profile = profiles.get(cashierId);

        if (!profile) {
          return [];
        }

        return [
          {
            cashierId,
            fullName: profile.fullName,
            publicId: profile.publicId,
            revenue: total,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.revenue - left.revenue ||
          left.fullName.localeCompare(right.fullName),
      );
  }

  private async netRevenue(where: Prisma.OrderWhereInput): Promise<number> {
    const [orders, refunds] = await Promise.all([
      this.prisma.order.aggregate({ where, _sum: { totalAmount: true } }),
      this.prisma.refund.aggregate({
        where: { order: where },
        _sum: { totalRefund: true },
      }),
    ]);

    return (orders._sum.totalAmount ?? 0) - (refunds._sum.totalRefund ?? 0);
  }

  private async unitsSold(where: Prisma.OrderWhereInput): Promise<number> {
    const lineDelegate = (this.prisma as any).orderLine ?? (this.prisma as any).orderItem;
    const [sold, returned] = await Promise.all([
      lineDelegate.aggregate({
        where: { order: where },
        _sum: { quantity: true },
      }),
      this.prisma.refundItem.aggregate({
        where: {
          OR: [
            { orderLine: { order: where } },
            { orderItem: { order: where } } as any,
          ],
        },
        _sum: { quantity: true },
      }),
    ]);

    return (sold._sum.quantity ?? 0) - (returned._sum.quantity ?? 0);
  }

  async variantRevenue(
    actor: AccessTokenPayload,
  ): Promise<
    Array<{ variantLabel: string; totalRevenue: number; totalQuantity: number }>
  > {
    const businessId = requireBusinessId(actor);
    const lineDelegate = (this.prisma as any).orderLine;
    if (!lineDelegate) {
      return [];
    }

    const lines = await lineDelegate.findMany({
      where: { order: { cashier: { businessId } } },
      select: {
        variantName: true,
        productName: true,
        subtotal: true,
        quantity: true,
      },
    });

    const grouping = new Map<
      string,
      { variantLabel: string; totalRevenue: number; totalQuantity: number }
    >();

    for (const line of lines) {
      // COALESCE(orderLine.variantName, orderLine.productName, 'Custom Ad-hoc Sale')
      const label =
        line.variantName || line.productName || 'Custom Ad-hoc Sale';
      const existing = grouping.get(label) ?? {
        variantLabel: label,
        totalRevenue: 0,
        totalQuantity: 0,
      };
      existing.totalRevenue += line.subtotal;
      existing.totalQuantity += line.quantity;
      grouping.set(label, existing);
    }

    return [...grouping.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
  }
}

function utcDay(now = new Date()): { gte: Date; lt: Date } {
  const gte = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  return {
    gte,
    lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000),
  };
}

function utcMonth(now = new Date()): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
