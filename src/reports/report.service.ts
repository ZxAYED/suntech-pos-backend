import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMethod, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { resolveLocationScope } from '../common/utils/location-scope';
import {
  getDhakaMonthBounds,
  getDhakaReportDateRange,
  getDhakaStartOfDay,
} from '../common/utils/timezone.util';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto } from './dto/analytics.query';
import { DashboardQueryDto } from './dto/dashboard.query';
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

export interface RecentTicket {
  id: string;
  invoiceNumber: string;
  customerName: string;
  itemsSummary: string;
  paymentMethod: string;
  totalAmount: number;
  status: string;
  createdAt: Date;
}

export interface AdminDashboard {
  globalDailyRevenue: number;
  globalRolling30DayRevenue: number;
  staffLeaderboard: StaffLeaderboardEntry[];
  periodRevenue: number;
  ordersCount: number;
  averageTicketValue: number;
  grossMarginPercent: number;
  paymentBreakdown: {
    cashAmount: number;
    digitalAmount: number;
    cashPercentage: number;
    digitalPercentage: number;
    byMethod: {
      COD: number;
      BKASH: number;
      NAGAD: number;
      BANK: number;
    };
  };
  topCategories: Array<{
    name: string;
    revenue: number;
    percentage: number;
  }>;
  recentTickets: RecentTicket[];
}

export interface PeriodAnalytics {
  grossRevenue: number;
  ordersCount: number;
  averageTicketValue: number;
  grossMarginPercent: number;
  cashPercentage: number;
  digitalPercentage: number;
  paymentBreakdown: {
    cashAmount: number;
    digitalAmount: number;
    cashPercentage: number;
    digitalPercentage: number;
    byMethod: {
      COD: number;
      BKASH: number;
      NAGAD: number;
      BANK: number;
    };
  };
  topCategories: Array<{
    name: string;
    revenue: number;
    percentage: number;
  }>;
}

export function getReportDateRange(
  range?: string,
  now = new Date(),
): { gte: Date; lte?: Date } {
  return getDhakaReportDateRange(range, now);
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

  private async resolveReportBusinessId(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
  ): Promise<string> {
    if (actor.role === Role.CASHIER) {
      if (!actor.businessId) {
        throw new ForbiddenException('Business context is required');
      }
      return actor.businessId;
    }
    let businessId = requestedBusinessId?.trim() || actor.businessId;
    if (!businessId && actor.role === Role.ADMIN) {
      const user = await this.prisma.user.findFirst({
        where: { id: actor.sub, deletedAt: null },
        select: {
          businessId: true,
          ownedBusinesses: {
            where: { deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });
      businessId = user?.businessId || user?.ownedBusinesses?.[0]?.id;
    }
    if (!businessId) {
      throw new ForbiddenException('Business context is required');
    }
    return businessId;
  }

  async dashboard(
    actor: AccessTokenPayload,
    query?: DashboardQueryDto,
  ): Promise<CashierDashboard | AdminDashboard> {
    const businessId = await this.resolveReportBusinessId(
      actor,
      query?.businessId,
    );
    const scope = resolveLocationScope(actor, query?.locationId, businessId);

    if (actor.role === Role.CASHIER) {
      return this.cashierDashboard(
        scope.businessId,
        actor.sub,
        scope.locationId,
      );
    }

    if (actor.role === Role.ADMIN) {
      return this.adminDashboard(
        scope.businessId,
        scope.locationId,
        query?.range,
      );
    }

    throw new ForbiddenException(
      'You do not have permission to perform this action',
    );
  }

  async analytics(
    admin: AccessTokenPayload,
    query?: AnalyticsQueryDto,
  ): Promise<PeriodAnalytics> {
    const businessId = await this.resolveReportBusinessId(
      admin,
      query?.businessId,
    );
    const scope = resolveLocationScope(admin, query?.locationId, businessId);
    const range = query?.range ?? 'monthly';
    const metrics = await this.computePeriodMetrics(
      scope.businessId,
      scope.locationId,
      range,
    );

    return {
      grossRevenue: metrics.periodRevenue,
      ordersCount: metrics.ordersCount,
      averageTicketValue: metrics.averageTicketValue,
      grossMarginPercent: metrics.grossMarginPercent,
      cashPercentage: metrics.paymentBreakdown.cashPercentage,
      digitalPercentage: metrics.paymentBreakdown.digitalPercentage,
      paymentBreakdown: metrics.paymentBreakdown,
      topCategories: metrics.topCategories,
    };
  }

  async transactions(actor: AccessTokenPayload, query: TransactionLogQueryDto) {
    const businessId = await this.resolveReportBusinessId(
      actor,
      query?.businessId,
    );
    const scope = resolveLocationScope(actor, query?.locationId, businessId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      cashier: { businessId: scope.businessId },
      ...(scope.locationId ? { locationId: scope.locationId } : {}),
    };

    if (query.range) {
      const dateRange = getReportDateRange(query.range);
      where.createdAt = {
        gte: dateRange.gte,
        ...(dateRange.lte ? { lte: dateRange.lte } : {}),
      };
    }

    if (query.search?.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
        { receiptNumber: { contains: searchTerm, mode: 'insensitive' } },
        { customerName: { contains: searchTerm, mode: 'insensitive' } },
        { customerPhone: { contains: searchTerm, mode: 'insensitive' } },
        { customerNumber: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const [total, orders] = await Promise.all([
      this.prisma.order.count
        ? this.prisma.order.count({ where })
        : Promise.resolve(0),
      this.prisma.order.findMany
        ? this.prisma.order.findMany({
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
          })
        : Promise.resolve([]),
    ]);

    const items = (orders || []).map((order) => ({
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
      items: (order.lines || []).map((line) => ({
        id: line.id,
        variantId: line.variantId,
        customItemName: line.variantId
          ? null
          : (line.variantName ?? line.productName),
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
    locationId?: string,
  ): Promise<CashierDashboard> {
    const today = utcDay();
    const month = utcMonth();
    const mine: Prisma.OrderWhereInput = {
      cashierId,
      cashier: { businessId },
      ...(locationId ? { locationId } : {}),
    };

    const [myDailyRevenue, myMonthlyRevenue, myDailyUnitsSold] =
      await Promise.all([
        this.netRevenue({ ...mine, createdAt: today }),
        this.netRevenue({ ...mine, createdAt: month }),
        this.unitsSold({ ...mine, createdAt: today }),
      ]);

    return { myDailyRevenue, myDailyUnitsSold, myMonthlyRevenue };
  }

  private async adminDashboard(
    businessId: string,
    locationId?: string,
    range?: string,
  ): Promise<AdminDashboard> {
    const today = utcDay();
    const rolling = {
      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lt: new Date(),
    };
    const month = utcMonth();
    const business: Prisma.OrderWhereInput = {
      cashier: { businessId },
      ...(locationId ? { locationId } : {}),
    };

    const [
      globalDailyRevenue,
      globalRolling30DayRevenue,
      staffLeaderboard,
      periodMetrics,
      recentTickets,
    ] = await Promise.all([
      this.netRevenue({ ...business, createdAt: today }),
      this.netRevenue({ ...business, createdAt: rolling }),
      this.leaderboard(businessId, month, locationId),
      this.computePeriodMetrics(businessId, locationId, range ?? 'today'),
      this.fetchRecentTickets(businessId, locationId),
    ]);

    return {
      globalDailyRevenue,
      globalRolling30DayRevenue,
      staffLeaderboard,
      periodRevenue: periodMetrics.periodRevenue,
      ordersCount: periodMetrics.ordersCount,
      averageTicketValue: periodMetrics.averageTicketValue,
      grossMarginPercent: periodMetrics.grossMarginPercent,
      paymentBreakdown: periodMetrics.paymentBreakdown,
      topCategories: periodMetrics.topCategories,
      recentTickets,
    };
  }

  private async computePeriodMetrics(
    businessId: string,
    locationId?: string,
    range?: string,
  ): Promise<{
    periodRevenue: number;
    ordersCount: number;
    averageTicketValue: number;
    grossMarginPercent: number;
    paymentBreakdown: {
      cashAmount: number;
      digitalAmount: number;
      cashPercentage: number;
      digitalPercentage: number;
      byMethod: {
        COD: number;
        BKASH: number;
        NAGAD: number;
        BANK: number;
      };
    };
    topCategories: Array<{
      name: string;
      revenue: number;
      percentage: number;
    }>;
  }> {
    const dateRange = getReportDateRange(range);
    const createdAt = {
      gte: dateRange.gte,
      ...(dateRange.lte ? { lte: dateRange.lte } : {}),
    };
    const periodOrderWhere: Prisma.OrderWhereInput = {
      cashier: { businessId },
      ...(locationId ? { locationId } : {}),
      createdAt,
    };

    const lineDelegate =
      (this.prisma as any).orderLine ?? (this.prisma as any).orderItem;

    const [periodRevenue, ordersCount, paymentGroups, lines, periodRefunds] =
      await Promise.all([
        this.netRevenue(periodOrderWhere),
        this.prisma.order.count
          ? this.prisma.order.count({
              where: {
                ...periodOrderWhere,
                status: OrderStatus.PAID,
              },
            })
          : Promise.resolve(0),
        this.prisma.order.groupBy
          ? this.prisma.order.groupBy({
              by: ['paymentMethod'],
              where: {
                ...periodOrderWhere,
                status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
              },
              _sum: { totalAmount: true },
            })
          : Promise.resolve([]),
        lineDelegate?.findMany
          ? lineDelegate.findMany({
              where: {
                order: {
                  ...periodOrderWhere,
                  status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
                },
              },
              select: {
                unitPrice: true,
                unitCost: true,
                categoryName: true,
                subtotal: true,
                quantity: true,
                variantId: true,
                refundItems: {
                  select: { quantity: true, refundAmount: true },
                },
                variant: {
                  select: {
                    costPrice: true,
                    product: {
                      select: {
                        category: {
                          select: { name: true },
                        },
                      },
                    },
                  },
                },
              },
            })
          : Promise.resolve([]),
        this.prisma.refund.findMany
          ? this.prisma.refund.findMany({
              where: { order: periodOrderWhere },
              select: {
                totalRefund: true,
                order: { select: { paymentMethod: true } },
              },
            })
          : Promise.resolve([]),
      ]);

    const averageTicketValue =
      ordersCount > 0 ? Math.round(periodRevenue / ordersCount) : 0;

    const byMethod = {
      COD: 0,
      BKASH: 0,
      NAGAD: 0,
      BANK: 0,
    };
    for (const group of paymentGroups || []) {
      if (group.paymentMethod && group.paymentMethod in byMethod) {
        byMethod[group.paymentMethod as PaymentMethod] =
          group._sum.totalAmount ?? 0;
      }
    }
    for (const ref of periodRefunds || []) {
      const pm = (ref.order as any)?.paymentMethod as PaymentMethod;
      if (pm && pm in byMethod) {
        byMethod[pm] = Math.max(0, byMethod[pm] - ref.totalRefund);
      }
    }
    const cashAmount = byMethod.COD;
    const digitalAmount = byMethod.BKASH + byMethod.NAGAD + byMethod.BANK;
    const totalPayment = cashAmount + digitalAmount;
    const cashPercentage =
      totalPayment > 0 ? Math.round((cashAmount / totalPayment) * 100) : 0;
    const digitalPercentage = totalPayment > 0 ? 100 - cashPercentage : 0;

    let catalogRevenue = 0;
    let catalogCost = 0;
    const categoryRevenueMap = new Map<string, number>();

    for (const line of lines || []) {
      const refundItems = Array.isArray((line as any).refundItems)
        ? (line as any).refundItems
        : [];
      const refundedQty = refundItems.reduce(
        (sum: number, r: any) => sum + (r.quantity ?? 0),
        0,
      );
      const refundedAmount = refundItems.reduce(
        (sum: number, r: any) =>
          sum + (r.refundAmount ?? (r.quantity ?? 0) * (line.unitPrice ?? 0)),
        0,
      );
      const subtotal = Math.max(0, (line.subtotal ?? 0) - refundedAmount);
      const quantity = Math.max(0, (line.quantity ?? 1) - refundedQty);
      if (subtotal === 0 && quantity === 0) {
        continue;
      }

      const unitCost =
        (line as any).unitCost != null
          ? (line as any).unitCost
          : line.variant?.costPrice;

      if (line.variantId && unitCost != null) {
        catalogRevenue += subtotal;
        catalogCost += unitCost * quantity;
      }

      const rawCategoryName =
        (line as any).categoryName ||
        line.variant?.product?.category?.name ||
        'Uncategorized';
      const categoryName = rawCategoryName.replace(/__del_\d+$/, '');
      categoryRevenueMap.set(
        categoryName,
        (categoryRevenueMap.get(categoryName) ?? 0) + subtotal,
      );
    }

    const grossMarginPercent =
      catalogRevenue > 0
        ? Number(
            (((catalogRevenue - catalogCost) / catalogRevenue) * 100).toFixed(
              1,
            ),
          )
        : 0;

    const totalCategoryRevenue = Array.from(categoryRevenueMap.values()).reduce(
      (a, b) => a + b,
      0,
    );

    const topCategories = [...categoryRevenueMap.entries()]
      .map(([name, revenue]) => ({
        name,
        revenue,
        percentage:
          totalCategoryRevenue > 0
            ? Number(((revenue / totalCategoryRevenue) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      periodRevenue,
      ordersCount,
      averageTicketValue,
      grossMarginPercent,
      paymentBreakdown: {
        cashAmount,
        digitalAmount,
        cashPercentage,
        digitalPercentage,
        byMethod,
      },
      topCategories,
    };
  }

  private async fetchRecentTickets(
    businessId: string,
    locationId?: string,
  ): Promise<RecentTicket[]> {
    if (!this.prisma.order.findMany) {
      return [];
    }

    const orders = await this.prisma.order.findMany({
      where: {
        cashier: { businessId },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        paymentMethod: true,
        totalAmount: true,
        status: true,
        createdAt: true,
        lines: {
          select: {
            productName: true,
            variantName: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return (orders || []).map((order) => {
      const itemsSummary =
        order.lines && order.lines.length > 0
          ? order.lines
              .map((l) =>
                l.variantName
                  ? `${l.variantName} (x${l.quantity})`
                  : `${l.productName} (x${l.quantity})`,
              )
              .join(', ')
          : 'Custom Sale';

      return {
        id: order.id,
        invoiceNumber: order.invoiceNumber,
        customerName: order.customerName || 'Walk-in Customer',
        itemsSummary,
        paymentMethod: order.paymentMethod,
        totalAmount: order.totalAmount,
        status: order.status,
        createdAt: order.createdAt,
      };
    });
  }

  private async leaderboard(
    businessId: string,
    createdAt: { gte: Date; lt: Date },
    locationId?: string,
  ): Promise<StaffLeaderboardEntry[]> {
    const where: Prisma.OrderWhereInput = {
      createdAt,
      cashier: {
        businessId,
        role: Role.CASHIER,
        deletedAt: null,
        ...(locationId ? { locationId } : {}),
      },
      ...(locationId ? { locationId } : {}),
    };
    const userWhere: Prisma.UserWhereInput = {
      businessId,
      role: Role.CASHIER,
      deletedAt: null,
      ...(locationId ? { locationId } : {}),
    };
    const [grouped, refunds, cashiers] = await Promise.all([
      this.prisma.order.groupBy
        ? this.prisma.order.groupBy({
            by: ['cashierId'],
            where,
            _sum: { totalAmount: true },
          })
        : Promise.resolve([]),
      this.prisma.refund.findMany
        ? this.prisma.refund.findMany({
            where: { order: where },
            select: {
              totalRefund: true,
              order: { select: { cashierId: true } },
            },
          })
        : Promise.resolve([]),
      this.prisma.user.findMany
        ? this.prisma.user.findMany({
            where: userWhere,
            select: { id: true, fullName: true, publicId: true },
          })
        : Promise.resolve([]),
    ]);
    const revenue = new Map(
      (grouped || []).map((row) => [row.cashierId, row._sum.totalAmount ?? 0]),
    );

    for (const refund of refunds || []) {
      const current = revenue.get(refund.order.cashierId);

      if (current === undefined) {
        continue;
      }

      revenue.set(refund.order.cashierId, current - refund.totalRefund);
    }

    const profiles = new Map(
      (cashiers || []).map((cashier) => [cashier.id, cashier]),
    );

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
    const lineDelegate =
      (this.prisma as any).orderLine ?? (this.prisma as any).orderItem;
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
    const businessId = await this.resolveReportBusinessId(actor);
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

    return [...grouping.values()].sort(
      (a, b) => b.totalRevenue - a.totalRevenue,
    );
  }
}

function utcDay(now = new Date()): { gte: Date; lt: Date } {
  const gte = getDhakaStartOfDay(now);

  return {
    gte,
    lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000),
  };
}

function utcMonth(now = new Date()): { gte: Date; lt: Date } {
  const { start, end } = getDhakaMonthBounds();

  return {
    gte: start,
    lt: end,
  };
}
