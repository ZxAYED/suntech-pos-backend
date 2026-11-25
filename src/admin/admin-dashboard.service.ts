import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpenseSourceType,
  OrderStatus,
  PaymentMethod,
  Prisma,
  Role,
  ShiftStatus,
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import {
  getDhakaDateParts,
  getDhakaDayRange,
  getDhakaEndOfDay,
  getDhakaStartOfDay,
} from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AdminDashboardRecentActivityQueryDto } from './dto/admin-dashboard-recent-activity.query';
import { AdminDashboardScopeQueryDto } from './dto/admin-dashboard-scope.query';

export interface DashboardOverviewKpis {
  todayGrossSales: number;
  todayNetSales: number;
  todayOrderCount: number;
  averageTicketValue: number;
  todayRefundCount: number;
  todayRefundedAmount: number;
  todayExpenseTotal: number;
  netCashflowToday: number;
}

export interface DashboardOverviewDrawer {
  hasActiveShift: boolean;
  shiftId: string | null;
  cashierName: string | null;
  cashierPublicId: string | null;
  openedAt: string | null;
  openingFloat: number;
  cashCollected: number;
  cashPaidOut: number;
  expectedCashInDrawer: number;
  currency: string;
}

export interface DashboardTodayShiftItem {
  id: string;
  cashierId: string;
  cashierName: string;
  cashierPublicId: string | null;
  status: ShiftStatus;
  openedAt: string;
  closedAt: string | null;
  startingAmount: number;
  closingAmount: number | null;
  expectedAmount: number | null;
  variance: number | null;
  cashSales: number;
  advancesOut: number;
  closingCashNotProvided: boolean;
  isOverdue: boolean;
}

export interface DashboardOlderOpenShiftItem {
  id: string;
  cashierId: string;
  cashierName: string;
  cashierPublicId: string | null;
  openedAt: string;
  startingAmount: number;
  isOverdue: boolean;
}

export interface DashboardLastClosedShift {
  id: string;
  cashierId: string;
  cashierName: string;
  cashierPublicId: string | null;
  openedAt: string;
  closedAt: string | null;
  startingAmount: number;
  closingAmount: number | null;
  expectedAmount: number | null;
  variance: number | null;
  closingCashNotProvided: boolean;
}

export interface DashboardCashierLoginStatus {
  cashierId: string;
  fullName: string;
  publicId: string | null;
  isLoggedIn: boolean;
  lastLoginAt: string | null;
  lastLogoutAt: string | null;
}

export interface DashboardOverviewResponse {
  date: string;
  businessId: string;
  locationId: string;
  locationName: string;
  kpis: DashboardOverviewKpis;
  drawer: DashboardOverviewDrawer;
  todayShifts?: DashboardTodayShiftItem[];
  todayShiftCounts?: {
    total: number;
    open: number;
    closed: number;
  };
  olderOpenShifts?: DashboardOlderOpenShiftItem[];
  olderOpenShiftCount?: number;
  lastClosedShift?: DashboardLastClosedShift | null;
  cashierLoginStatuses?: DashboardCashierLoginStatus[];
}

export interface CriticalStockItem {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  currentStock: number;
  reorderLevel: number;
}

export interface DashboardInventoryAlertsResponse {
  lowStockThreshold: number;
  lowStockCount: number;
  outOfStockCount: number;
  criticalItems: CriticalStockItem[];
}

export interface DashboardRecentTicket {
  id: string;
  invoiceNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  itemsSummary: string | null;
  paymentMethod: string;
  paymentLabel: string;
  totalAmount: number;
  status: string;
  occurredAt: string;
  locationId?: string | null;
  locationName?: string | null;
  branchName?: string | null;
  businessName?: string | null;
  cashierName?: string | null;
  cashierPublicId?: string | null;
}

export interface DashboardRecentActivityResponse {
  tickets: DashboardRecentTicket[];
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves and verifies scope permissions.
   * Admins must explicitly provide businessId and locationId (no auto-token parsing).
   */
  async resolveAndValidateScope(
    actor: AccessTokenPayload,
    query: AdminDashboardScopeQueryDto,
  ): Promise<{ businessId: string; locationId: string; locationName: string }> {
    if (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) {
      if (!query.businessId?.trim() || !query.locationId?.trim()) {
        throw new BadRequestException(
          'Both businessId and locationId are required for the admin dashboard',
        );
      }
    }

    const businessId =
      query.businessId?.trim() ||
      (actor.role === Role.CASHIER ? actor.businessId : undefined);
    const locationId =
      query.locationId?.trim() ||
      (actor.role === Role.CASHIER ? actor.locationId : undefined);

    if (!businessId || !locationId) {
      throw new BadRequestException(
        'businessId and locationId are required to load dashboard metrics',
      );
    }

    if (actor.role === Role.ADMIN) {
      const ownedBusinessIds = new Set(actor.businessIds ?? []);
      if (actor.businessId) {
        ownedBusinessIds.add(actor.businessId);
      }

      if (!ownedBusinessIds.has(businessId)) {
        const isOwner = await this.prisma.business.findFirst({
          where: { id: businessId, ownerId: actor.sub, deletedAt: null },
          select: { id: true },
        });
        if (!isOwner) {
          throw new ForbiddenException(
            'You do not have access to manage this business',
          );
        }
      }
    }

    if (actor.role === Role.CASHIER) {
      if (actor.businessId !== businessId || actor.locationId !== locationId) {
        throw new ForbiddenException(
          'Cashiers may only access metrics for their assigned location',
        );
      }
    }

    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        deletedAt: null,
      },
      select: { id: true, name: true, businessId: true },
    });

    if (!location) {
      throw new NotFoundException(
        'Branch location was not found in the selected business',
      );
    }

    if (location.businessId && location.businessId !== businessId) {
      throw new BadRequestException(
        'Location does not belong to the specified business',
      );
    }

    return {
      businessId,
      locationId: location.id,
      locationName: location.name,
    };
  }

  /**
   * 1. GET /admin/dashboard/overview
   */
  async getOverview(
    actor: AccessTokenPayload,
    query: AdminDashboardScopeQueryDto,
  ): Promise<DashboardOverviewResponse> {
    const { businessId, locationId, locationName } =
      await this.resolveAndValidateScope(actor, query);

    const now = new Date();
    const { start: startOfToday, nextStart: nextDayStart } =
      getDhakaDayRange(now);
    const { year, month, day } = getDhakaDateParts(now);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const orderWhere: Prisma.OrderWhereInput = {
      locationId,
      occurredAt: { gte: startOfToday, lt: nextDayStart },
      status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
    };

    const refundWhere: Prisma.RefundWhereInput = {
      order: {
        locationId,
      },
      createdAt: { gte: startOfToday, lt: nextDayStart },
    };

    const expenseWhere: Prisma.ExpenseWhereInput = {
      businessId,
      locationId,
      spentAt: { gte: startOfToday, lt: nextDayStart },
      deletedAt: null,
      sourceType: {
        in: [ExpenseSourceType.MANUAL, ExpenseSourceType.PAYROLL_NET],
      },
    };

    const [
      orderCount,
      grossOrdersAgg,
      refundCount,
      refundsAgg,
      expensesAgg,
      todayShiftsRaw,
      olderOpenShiftsRaw,
      lastClosedShiftRaw,
      branchCashiers,
    ] = await Promise.all([
      this.prisma.order.count({ where: orderWhere }),
      this.prisma.order.aggregate({
        where: orderWhere,
        _sum: { totalAmount: true },
      }),
      this.prisma.refund.count({ where: refundWhere }),
      this.prisma.refund.aggregate({
        where: refundWhere,
        _sum: { totalRefund: true },
      }),
      this.prisma.expense.aggregate({
        where: expenseWhere,
        _sum: { amount: true },
      }),
      this.prisma.shiftSession.findMany({
        where: {
          businessId,
          locationId,
          openedAt: { gte: startOfToday, lt: nextDayStart },
          ...(actor.role === Role.CASHIER ? { cashierId: actor.sub } : {}),
        },
        include: {
          cashier: {
            select: {
              id: true,
              fullName: true,
              publicId: true,
            },
          },
        },
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.shiftSession.findMany({
        where: {
          businessId,
          locationId,
          status: ShiftStatus.OPEN,
          openedAt: { lt: startOfToday },
          ...(actor.role === Role.CASHIER ? { cashierId: actor.sub } : {}),
        },
        include: {
          cashier: {
            select: {
              id: true,
              fullName: true,
              publicId: true,
            },
          },
        },
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.shiftSession.findFirst({
        where: {
          businessId,
          locationId,
          status: ShiftStatus.CLOSED,
          ...(actor.role === Role.CASHIER ? { cashierId: actor.sub } : {}),
        },
        include: {
          cashier: {
            select: {
              id: true,
              fullName: true,
              publicId: true,
            },
          },
        },
        orderBy: { closedAt: 'desc' },
      }),
      actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN
        ? this.prisma.user.findMany({
            where: {
              businessId,
              locationId,
              role: Role.CASHIER,
              deletedAt: null,
            },
            select: {
              id: true,
              fullName: true,
              publicId: true,
              isLoggedIn: true,
              lastLoginAt: true,
              lastLogoutAt: true,
            },
            orderBy: { fullName: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const todayOrderCount = orderCount ?? 0;
    const todayGrossSales = grossOrdersAgg?._sum?.totalAmount ?? 0;
    const todayRefundCount = refundCount ?? 0;
    const todayRefundedAmount = refundsAgg?._sum?.totalRefund ?? 0;
    const todayNetSales = todayGrossSales - todayRefundedAmount;
    const averageTicketValue =
      todayOrderCount > 0 ? Math.round(todayNetSales / todayOrderCount) : 0;
    const todayExpenseTotal = expensesAgg?._sum?.amount ?? 0;
    const netCashflowToday = todayNetSales - todayExpenseTotal;

    const openShiftIds = (todayShiftsRaw ?? [])
      .filter((s) => s.status === ShiftStatus.OPEN)
      .map((s) => s.id);

    const advancesMap = new Map<string, number>();
    if (openShiftIds.length > 0 && (this.prisma.employeeAdvance as any)?.groupBy) {
      const openShiftAdvances = await (this.prisma.employeeAdvance as any).groupBy({
        by: ['shiftId'],
        where: {
          shiftId: { in: openShiftIds },
          businessId,
          deletedAt: null,
        },
        _sum: { amount: true },
      });
      for (const a of openShiftAdvances) {
        if (a.shiftId) {
          advancesMap.set(a.shiftId, a._sum?.amount ?? 0);
        }
      }
    }

    const todayShifts: DashboardTodayShiftItem[] = (todayShiftsRaw ?? []).map(
      (s) => {
        const isOpen = s.status === ShiftStatus.OPEN;
        const liveCashSales = isOpen
          ? (s.cashCollected ?? s.cashSales ?? 0)
          : s.cashSales;
        const liveAdvancesOut = isOpen
          ? (advancesMap.get(s.id) ?? s.advancesOut ?? 0)
          : s.advancesOut;
        const liveExpectedAmount = isOpen
          ? (s.startingAmount ?? 0) + liveCashSales - liveAdvancesOut
          : s.expectedAmount;

        return {
          id: s.id,
          cashierId: s.cashierId,
          cashierName: s.cashier?.fullName ?? 'Store Cashier',
          cashierPublicId: s.cashier?.publicId ?? null,
          status: s.status,
          openedAt: s.openedAt.toISOString(),
          closedAt: s.closedAt ? s.closedAt.toISOString() : null,
          startingAmount: s.startingAmount,
          closingAmount: s.closingAmount,
          expectedAmount: liveExpectedAmount,
          variance: s.variance,
          cashSales: liveCashSales,
          advancesOut: liveAdvancesOut,
          closingCashNotProvided:
            s.status === ShiftStatus.CLOSED && s.closingAmount === null,
          isOverdue: false,
        };
      },
    );

    const todayShiftCounts = {
      total: todayShifts.length,
      open: todayShifts.filter((s) => s.status === ShiftStatus.OPEN).length,
      closed: todayShifts.filter((s) => s.status === ShiftStatus.CLOSED).length,
    };

    const olderOpenShifts: DashboardOlderOpenShiftItem[] = (
      olderOpenShiftsRaw ?? []
    ).map((s) => ({
      id: s.id,
      cashierId: s.cashierId,
      cashierName: s.cashier?.fullName ?? 'Store Cashier',
      cashierPublicId: s.cashier?.publicId ?? null,
      openedAt: s.openedAt.toISOString(),
      startingAmount: s.startingAmount,
      isOverdue: true,
    }));
    const olderOpenShiftCount = olderOpenShifts.length;

    const lastClosedShift: DashboardLastClosedShift | null = lastClosedShiftRaw
      ? {
          id: lastClosedShiftRaw.id,
          cashierId: lastClosedShiftRaw.cashierId,
          cashierName:
            lastClosedShiftRaw.cashier?.fullName ?? 'Store Cashier',
          cashierPublicId: lastClosedShiftRaw.cashier?.publicId ?? null,
          openedAt: lastClosedShiftRaw.openedAt.toISOString(),
          closedAt: lastClosedShiftRaw.closedAt
            ? lastClosedShiftRaw.closedAt.toISOString()
            : null,
          startingAmount: lastClosedShiftRaw.startingAmount,
          closingAmount: lastClosedShiftRaw.closingAmount,
          expectedAmount: lastClosedShiftRaw.expectedAmount,
          variance: lastClosedShiftRaw.variance,
          closingCashNotProvided: lastClosedShiftRaw.closingAmount === null,
        }
      : null;

    let cashierLoginStatuses: DashboardCashierLoginStatus[] | undefined =
      undefined;
    if (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) {
      cashierLoginStatuses = (branchCashiers ?? []).map((c) => ({
        cashierId: c.id,
        fullName: c.fullName,
        publicId: c.publicId,
        isLoggedIn: c.isLoggedIn,
        lastLoginAt: c.lastLoginAt ? c.lastLoginAt.toISOString() : null,
        lastLogoutAt: c.lastLogoutAt ? c.lastLogoutAt.toISOString() : null,
      }));
    }

    const activeShift = (todayShiftsRaw ?? []).find(
      (s) => s.status === ShiftStatus.OPEN,
    );

    let drawer: DashboardOverviewDrawer;
    if (!activeShift) {
      drawer = {
        hasActiveShift: false,
        shiftId: null,
        cashierName: null,
        cashierPublicId: null,
        openedAt: null,
        openingFloat: 0,
        cashCollected: 0,
        cashPaidOut: 0,
        expectedCashInDrawer: 0,
        currency: 'BDT',
      };
    } else {
      const [cashOrdersAgg, codRefundsAgg, advancesAgg] = await Promise.all([
        this.prisma.order.aggregate({
          where: {
            shiftId: activeShift.id,
            paymentMethod: PaymentMethod.COD,
            status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.refund.aggregate({
          where: {
            payoutShiftId: activeShift.id,
            order: {
              paymentMethod: PaymentMethod.COD,
            },
          },
          _sum: { totalRefund: true },
        }),
        this.prisma.employeeAdvance.aggregate({
          where: {
            shiftId: activeShift.id,
            businessId,
            deletedAt: null,
          },
          _sum: { amount: true },
        }),
      ]);

      const rawCashSales = cashOrdersAgg?._sum?.totalAmount ?? 0;
      const codRefunds = codRefundsAgg?._sum?.totalRefund ?? 0;
      const cashCollected = rawCashSales - codRefunds;
      const cashPaidOut = advancesAgg?._sum?.amount ?? 0;
      const openingFloat = activeShift.startingAmount ?? 0;
      const expectedCashInDrawer = openingFloat + cashCollected - cashPaidOut;

      drawer = {
        hasActiveShift: true,
        shiftId: activeShift.id,
        cashierName: activeShift.cashier?.fullName ?? 'Store Cashier',
        cashierPublicId: activeShift.cashier?.publicId ?? null,
        openedAt: activeShift.openedAt
          ? activeShift.openedAt.toISOString()
          : null,
        openingFloat,
        cashCollected,
        cashPaidOut,
        expectedCashInDrawer,
        currency: 'BDT',
      };
    }

    return {
      date: dateStr,
      businessId,
      locationId,
      locationName,
      kpis: {
        todayGrossSales,
        todayNetSales,
        todayOrderCount,
        averageTicketValue,
        todayRefundCount,
        todayRefundedAmount,
        todayExpenseTotal,
        netCashflowToday,
      },
      drawer,
      todayShifts,
      todayShiftCounts,
      olderOpenShifts,
      olderOpenShiftCount,
      lastClosedShift,
      ...(cashierLoginStatuses ? { cashierLoginStatuses } : {}),
    };
  }

  /**
   * 2. GET /admin/dashboard/inventory-alerts
   */
  async getInventoryAlerts(
    actor: AccessTokenPayload,
    query: AdminDashboardScopeQueryDto,
  ): Promise<DashboardInventoryAlertsResponse> {
    const { businessId, locationId } = await this.resolveAndValidateScope(
      actor,
      query,
    );

    const variants = await this.prisma.variant.findMany({
      where: {
        businessId,
        deletedAt: null,
        isActive: true,
        product: {
          deletedAt: null,
          isActive: true,
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        product: {
          select: {
            name: true,
          },
        },
        locationStocks: {
          where: { locationId },
          select: {
            stock: true,
          },
        },
      },
    });

    let lowStockCount = 0;
    let outOfStockCount = 0;
    const criticalItems: CriticalStockItem[] = [];

    for (const v of variants) {
      const currentStock = v.locationStocks?.[0]?.stock ?? 0;
      if (currentStock <= 0) {
        outOfStockCount++;
        criticalItems.push({
          variantId: v.id,
          productName: v.product?.name ?? 'Unknown Product',
          variantName: v.name,
          sku: v.sku,
          currentStock,
          reorderLevel: 5,
        });
      } else if (currentStock <= 5) {
        lowStockCount++;
        criticalItems.push({
          variantId: v.id,
          productName: v.product?.name ?? 'Unknown Product',
          variantName: v.name,
          sku: v.sku,
          currentStock,
          reorderLevel: 5,
        });
      }
    }

    criticalItems.sort((a, b) => a.currentStock - b.currentStock);

    return {
      lowStockThreshold: 5,
      lowStockCount,
      outOfStockCount,
      criticalItems: criticalItems.slice(0, 20),
    };
  }

  /**
   * 3. GET /admin/dashboard/recent-activity
   */
  async getRecentActivity(
    actor: AccessTokenPayload,
    query: AdminDashboardRecentActivityQueryDto,
  ): Promise<DashboardRecentActivityResponse> {
    const { locationId } = await this.resolveAndValidateScope(actor, query);
    const take = Math.min(50, Math.max(1, Number(query.limit) || 5));

    const orders = await this.prisma.order.findMany({
      where: {
        locationId,
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customerPhone: true,
        paymentMethod: true,
        totalAmount: true,
        status: true,
        occurredAt: true,
        locationId: true,
        location: {
          select: {
            id: true,
            name: true,
            business: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        cashier: {
          select: {
            id: true,
            fullName: true,
            publicId: true,
          },
        },
        lines: {
          select: {
            productName: true,
            variantName: true,
            quantity: true,
          },
        },
      },
      orderBy: { occurredAt: 'desc' },
      take,
    });

    const paymentLabels: Record<PaymentMethod, string> = {
      [PaymentMethod.COD]: 'Cash',
      [PaymentMethod.BKASH]: 'bKash',
      [PaymentMethod.NAGAD]: 'Nagad',
      [PaymentMethod.BANK]: 'Bank',
    };

    const tickets: DashboardRecentTicket[] = orders.map((o) => {
      const itemsSummary =
        o.lines && o.lines.length > 0
          ? o.lines
              .map((l) =>
                l.variantName
                  ? `${l.variantName} (x${l.quantity})`
                  : `${l.productName} (x${l.quantity})`,
              )
              .join(', ')
          : 'Custom Sale';

      const locationName = (o as any).location?.name ?? null;
      const branchName = locationName;
      const businessName = (o as any).location?.business?.name ?? null;
      const cashierName = (o as any).cashier?.fullName ?? null;
      const cashierPublicId = (o as any).cashier?.publicId ?? null;
      const sellerName = cashierName;
      const sellerRole = (o as any).cashier?.role ?? null;

      return {
        id: o.id,
        invoiceNumber: o.invoiceNumber,
        customerName: o.customerName ?? 'Walk-in Customer',
        customerPhone: o.customerPhone ?? null,
        itemsSummary,
        paymentMethod: o.paymentMethod,
        paymentLabel: paymentLabels[o.paymentMethod] ?? o.paymentMethod,
        totalAmount: o.totalAmount,
        status: o.status,
        occurredAt: o.occurredAt.toISOString(),
        locationId: o.locationId,
        locationName,
        branchName,
        businessName,
        cashierName,
        cashierPublicId,
        sellerName,
        sellerRole,
      };
    });

    return { tickets };
  }
}
