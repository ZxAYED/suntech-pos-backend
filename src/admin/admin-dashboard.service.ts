import {
  BadRequestException,
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
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import {
  getDhakaDateParts,
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

export interface DashboardOverviewResponse {
  date: string;
  businessId: string;
  locationId: string;
  locationName: string;
  kpis: DashboardOverviewKpis;
  drawer: DashboardOverviewDrawer;
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
        businessId,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });

    if (!location) {
      throw new NotFoundException(
        'Branch location was not found in the selected business',
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
    const startOfToday = getDhakaStartOfDay(now);
    const endOfToday = getDhakaEndOfDay(now);
    const { year, month, day } = getDhakaDateParts(now);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const orderWhere: Prisma.OrderWhereInput = {
      locationId,
      occurredAt: { gte: startOfToday, lte: endOfToday },
      status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
    };

    const refundWhere: Prisma.RefundWhereInput = {
      order: {
        locationId,
      },
      createdAt: { gte: startOfToday, lte: endOfToday },
    };

    const expenseWhere: Prisma.ExpenseWhereInput = {
      businessId,
      locationId,
      spentAt: { gte: startOfToday, lte: endOfToday },
      deletedAt: null,
    };

    const [
      orderCount,
      grossOrdersAgg,
      refundCount,
      refundsAgg,
      expensesAgg,
      activeShift,
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
      this.prisma.shiftSession.findFirst({
        where: {
          businessId,
          locationId,
          status: ShiftStatus.OPEN,
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
    ]);

    const todayOrderCount = orderCount ?? 0;
    const todayGrossSales = grossOrdersAgg?._sum?.totalAmount ?? 0;
    const todayRefundCount = refundCount ?? 0;
    const todayRefundedAmount = refundsAgg?._sum?.totalRefund ?? 0;
    const todayNetSales = Math.max(0, todayGrossSales - todayRefundedAmount);
    const averageTicketValue =
      todayOrderCount > 0 ? Math.round(todayNetSales / todayOrderCount) : 0;
    const todayExpenseTotal = expensesAgg?._sum?.amount ?? 0;
    const netCashflowToday = todayNetSales - todayExpenseTotal;

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
            order: {
              shiftId: activeShift.id,
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
      const cashCollected = Math.max(0, rawCashSales - codRefunds);
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
      };
    });

    return { tickets };
  }
}
