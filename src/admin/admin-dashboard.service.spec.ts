import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Role, ShiftStatus } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { PrismaService } from '../prisma/prisma.service';
import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminDashboardService', () => {
  const locationFindFirst = jest.fn();
  const businessFindFirst = jest.fn();
  const orderCount = jest.fn();
  const orderAggregate = jest.fn();
  const orderFindMany = jest.fn();
  const refundCount = jest.fn();
  const refundAggregate = jest.fn();
  const expenseAggregate = jest.fn();
  const shiftSessionFindFirst = jest.fn();
  const shiftSessionFindMany = jest.fn();
  const userFindMany = jest.fn();
  const employeeAdvanceAggregate = jest.fn();
  const variantFindMany = jest.fn();

  const prisma = {
    location: { findFirst: locationFindFirst },
    business: { findFirst: businessFindFirst },
    order: {
      count: orderCount,
      aggregate: orderAggregate,
      findMany: orderFindMany,
    },
    refund: {
      count: refundCount,
      aggregate: refundAggregate,
    },
    expense: { aggregate: expenseAggregate },
    shiftSession: {
      findFirst: shiftSessionFindFirst,
      findMany: shiftSessionFindMany,
    },
    user: { findMany: userFindMany },
    employeeAdvance: { aggregate: employeeAdvanceAggregate },
    variant: { findMany: variantFindMany },
  } as unknown as PrismaService;

  const service = new AdminDashboardService(prisma);

  const adminActor: AccessTokenPayload = {
    sub: 'admin-uuid-1',
    role: Role.ADMIN,
    businessId: 'biz-1',
    businessIds: ['biz-1'],
  };

  const cashierActor: AccessTokenPayload = {
    sub: 'cashier-uuid-1',
    role: Role.CASHIER,
    businessId: 'biz-1',
    locationId: 'loc-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    locationFindFirst.mockResolvedValue({
      id: 'loc-1',
      name: 'Main Branch',
      businessId: 'biz-1',
    });
    shiftSessionFindMany.mockResolvedValue([]);
    shiftSessionFindFirst.mockResolvedValue(null);
    userFindMany.mockResolvedValue([]);
  });

  describe('resolveAndValidateScope', () => {
    it('throws BadRequestException if Admin does not provide businessId or locationId', async () => {
      await expect(
        service.resolveAndValidateScope(adminActor, {
          businessId: '',
          locationId: 'loc-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.resolveAndValidateScope(adminActor, {
          businessId: 'biz-1',
          locationId: '',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ForbiddenException if Admin does not own the business', async () => {
      businessFindFirst.mockResolvedValue(null);

      await expect(
        service.resolveAndValidateScope(adminActor, {
          businessId: 'biz-other',
          locationId: 'loc-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException if location is not in the specified business', async () => {
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.resolveAndValidateScope(adminActor, {
          businessId: 'biz-1',
          locationId: 'loc-missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves valid business and location successfully', async () => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Dhanmondi Branch',
        businessId: 'biz-1',
      });

      const scope = await service.resolveAndValidateScope(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(scope).toEqual({
        businessId: 'biz-1',
        locationId: 'loc-1',
        locationName: 'Dhanmondi Branch',
      });
    });
  });

  describe('getOverview', () => {
    it('returns overview with no active shift when no open shift exists', async () => {
      orderCount.mockResolvedValue(10);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 50000 } });
      refundCount.mockResolvedValue(1);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 2000 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 8000 } });
      shiftSessionFindMany.mockResolvedValue([]);
      shiftSessionFindFirst.mockResolvedValue(null);

      const overview = await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.kpis.todayGrossSales).toBe(50000);
      expect(overview.kpis.todayRefundedAmount).toBe(2000);
      expect(overview.kpis.todayNetSales).toBe(48000);
      expect(overview.kpis.todayOrderCount).toBe(10);
      expect(overview.kpis.averageTicketValue).toBe(4800);
      expect(overview.kpis.todayExpenseTotal).toBe(8000);
      expect(overview.kpis.netCashflowToday).toBe(40000);

      expect(overview.drawer).toEqual({
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
      });
      expect(overview.todayShifts).toEqual([]);
      expect(overview.todayShiftCounts).toEqual({ total: 0, open: 0, closed: 0 });
    });

    it('returns overview with active shift drawer metrics and today shifts', async () => {
      orderCount.mockResolvedValue(5);
      orderAggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: 25000 } }) // day orders
        .mockResolvedValueOnce({ _sum: { totalAmount: 15000 } }); // shift cash orders
      refundCount.mockResolvedValue(0);
      refundAggregate
        .mockResolvedValueOnce({ _sum: { totalRefund: 0 } }) // day refunds
        .mockResolvedValueOnce({ _sum: { totalRefund: 0 } }); // shift COD refunds
      expenseAggregate.mockResolvedValue({ _sum: { amount: 3000 } });
      employeeAdvanceAggregate.mockResolvedValue({ _sum: { amount: 1000 } });

      const activeShift = {
        id: 'shift-1',
        cashierId: 'user-1',
        startingAmount: 5000,
        closingAmount: null,
        expectedAmount: null,
        variance: null,
        cashSales: 0,
        advancesOut: 0,
        status: ShiftStatus.OPEN,
        openedAt: new Date('2026-10-31T04:00:00Z'),
        closedAt: null,
        cashier: {
          id: 'user-1',
          fullName: 'Tanvir Cashier',
          publicId: 'CSH-0001',
        },
      };

      shiftSessionFindMany
        .mockResolvedValueOnce([activeShift]) // todayShiftsRaw
        .mockResolvedValueOnce([]); // olderOpenShiftsRaw
      shiftSessionFindFirst.mockResolvedValue(null); // lastClosedShiftRaw

      const overview = await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.drawer.hasActiveShift).toBe(true);
      expect(overview.drawer.shiftId).toBe('shift-1');
      expect(overview.drawer.cashierName).toBe('Tanvir Cashier');
      expect(overview.drawer.cashierPublicId).toBe('CSH-0001');
      expect(overview.drawer.openingFloat).toBe(5000);
      expect(overview.drawer.cashCollected).toBe(15000);
      expect(overview.drawer.cashPaidOut).toBe(1000);
      expect(overview.drawer.expectedCashInDrawer).toBe(19000); // 5000 + 15000 - 1000

      expect(overview.todayShifts).toHaveLength(1);
      expect(overview.todayShiftCounts).toEqual({ total: 1, open: 1, closed: 0 });
    });

    it('correctly calculates mixed payment scenario: kpis.netCashflowToday (18k) vs drawer.expectedCashInDrawer (10k)', async () => {
      orderCount.mockResolvedValue(2);
      orderAggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: 25000 } })
        .mockResolvedValueOnce({ _sum: { totalAmount: 10000 } });

      refundCount.mockResolvedValue(1);
      refundAggregate
        .mockResolvedValueOnce({ _sum: { totalRefund: 2000 } })
        .mockResolvedValueOnce({ _sum: { totalRefund: 2000 } });

      expenseAggregate.mockResolvedValue({ _sum: { amount: 5000 } });
      employeeAdvanceAggregate.mockResolvedValue({ _sum: { amount: 1000 } });

      const activeShift = {
        id: 'shift-mixed-1',
        cashierId: 'user-1',
        startingAmount: 3000,
        closingAmount: null,
        expectedAmount: null,
        variance: null,
        cashSales: 0,
        advancesOut: 0,
        status: ShiftStatus.OPEN,
        openedAt: new Date('2026-10-31T04:00:00Z'),
        closedAt: null,
        cashier: {
          id: 'user-1',
          fullName: 'Tanvir Cashier',
          publicId: 'CSH-0001',
        },
      };

      shiftSessionFindMany
        .mockResolvedValueOnce([activeShift]) // todayShiftsRaw
        .mockResolvedValueOnce([]); // olderOpenShiftsRaw

      const overview = await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.kpis.netCashflowToday).toBe(18000);
      expect(overview.drawer.expectedCashInDrawer).toBe(10000);
    });

    it('returns olderOpenShifts and lastClosedShift with closingCashNotProvided flag', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const oldShift = {
        id: 'shift-old-1',
        cashierId: 'cashier-1',
        startingAmount: 2000,
        status: ShiftStatus.OPEN,
        openedAt: new Date('2026-10-20T04:00:00Z'),
        cashier: { id: 'cashier-1', fullName: 'Old Cashier', publicId: 'CSH-OLD' },
      };

      const lastClosed = {
        id: 'shift-closed-1',
        cashierId: 'cashier-2',
        startingAmount: 5000,
        closingAmount: null, // Count pending
        expectedAmount: 8000,
        variance: null,
        status: ShiftStatus.CLOSED,
        openedAt: new Date('2026-10-25T04:00:00Z'),
        closedAt: new Date('2026-10-25T12:00:00Z'),
        cashier: { id: 'cashier-2', fullName: 'Closed Cashier', publicId: 'CSH-CLS' },
      };

      shiftSessionFindMany
        .mockResolvedValueOnce([]) // todayShiftsRaw
        .mockResolvedValueOnce([oldShift]); // olderOpenShiftsRaw
      shiftSessionFindFirst.mockResolvedValue(lastClosed); // lastClosedShiftRaw

      const overview = await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.olderOpenShifts).toHaveLength(1);
      expect(overview.olderOpenShiftCount).toBe(1);
      expect(overview.olderOpenShifts![0].isOverdue).toBe(true);

      expect(overview.lastClosedShift).toBeDefined();
      expect(overview.lastClosedShift?.closingCashNotProvided).toBe(true);
      expect(overview.lastClosedShift?.closingAmount).toBeNull();
    });

    it('returns cashierLoginStatuses to Admin without leaking sessionId or passwords', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      userFindMany.mockResolvedValue([
        {
          id: 'cashier-1',
          fullName: 'Tanvir',
          publicId: 'CSH-1',
          isLoggedIn: true,
          lastLoginAt: new Date('2026-11-06T08:00:00Z'),
          lastLogoutAt: null,
        },
        {
          id: 'cashier-2',
          fullName: 'Rahim',
          publicId: 'CSH-2',
          isLoggedIn: false,
          lastLoginAt: new Date('2026-11-05T08:00:00Z'),
          lastLogoutAt: new Date('2026-11-05T17:00:00Z'),
        },
      ]);

      const overview = await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.cashierLoginStatuses).toBeDefined();
      expect(overview.cashierLoginStatuses).toHaveLength(2);
      expect(overview.cashierLoginStatuses![0]).toEqual({
        cashierId: 'cashier-1',
        fullName: 'Tanvir',
        publicId: 'CSH-1',
        isLoggedIn: true,
        lastLoginAt: expect.any(String),
        lastLogoutAt: null,
      });
      // Ensure no sessionId property exists
      expect((overview.cashierLoginStatuses![0] as any).sessionId).toBeUndefined();
    });

    it('restricts cashier callers to their own shifts and omits cashierLoginStatuses', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const overview = await service.getOverview(cashierActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.cashierLoginStatuses).toBeUndefined();
      expect(userFindMany).not.toHaveBeenCalled();

      // Check query was scoped to cashierId
      expect(shiftSessionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cashierId: 'cashier-uuid-1',
          }),
        }),
      );
    });

    it('isolates expenses strictly by locationId, excluding other branches and unallocated records', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 4500 } });

      await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(expenseAggregate).toHaveBeenCalledWith({
        where: expect.objectContaining({
          businessId: 'biz-1',
          locationId: 'loc-1',
        }),
        _sum: { amount: true },
      });
    });

    it('excludes soft-deleted expense records (deletedAt: null check)', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(expenseAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        }),
      );
    });

    it('handles zero vs missing data gracefully without NaN or crash', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: null } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: null } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: null } });

      const overview = await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(overview.kpis.todayGrossSales).toBe(0);
      expect(overview.kpis.todayRefundedAmount).toBe(0);
      expect(overview.kpis.todayNetSales).toBe(0);
      expect(overview.kpis.averageTicketValue).toBe(0);
      expect(overview.kpis.todayExpenseTotal).toBe(0);
      expect(overview.kpis.netCashflowToday).toBe(0);
    });

    it('queries expenses strictly within Asia/Dhaka midnight boundaries', async () => {
      orderCount.mockResolvedValue(0);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 0 } });
      refundCount.mockResolvedValue(0);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await service.getOverview(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      const callArgs = expenseAggregate.mock.calls[0][0];
      const spentAtFilter = callArgs.where.spentAt;
      expect(spentAtFilter).toBeDefined();
      expect(spentAtFilter.gte).toBeInstanceOf(Date);
      expect(spentAtFilter.lt).toBeInstanceOf(Date);
      expect(spentAtFilter.gte.getTime()).toBeLessThan(
        spentAtFilter.lt.getTime(),
      );
      expect(spentAtFilter.lt.getTime() - spentAtFilter.gte.getTime()).toBe(
        24 * 60 * 60 * 1000,
      );
    });
  });

  describe('getInventoryAlerts', () => {
    it('returns low stock and out of stock counts and critical items', async () => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
      });

      variantFindMany.mockResolvedValue([
        {
          id: 'v-1',
          name: 'Blue Shirt M',
          sku: 'SHIRT-BLU-M',
          product: { name: 'Cotton Shirt' },
          locationStocks: [{ stock: 0 }],
        },
        {
          id: 'v-2',
          name: 'Red Shirt L',
          sku: 'SHIRT-RED-L',
          product: { name: 'Cotton Shirt' },
          locationStocks: [{ stock: 3 }],
        },
        {
          id: 'v-3',
          name: 'Black Pants 32',
          sku: 'PANT-BLK-32',
          product: { name: 'Denim Pants' },
          locationStocks: [{ stock: 15 }],
        },
      ]);

      const alerts = await service.getInventoryAlerts(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(variantFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            businessId: 'biz-1',
            deletedAt: null,
            isActive: true,
            product: {
              deletedAt: null,
              isActive: true,
            },
          },
        }),
      );
      expect(alerts.lowStockThreshold).toBe(5);
      expect(alerts.outOfStockCount).toBe(1);
      expect(alerts.lowStockCount).toBe(1);
      expect(alerts.criticalItems).toHaveLength(2);
      expect(alerts.criticalItems[0].variantId).toBe('v-1');
      expect(alerts.criticalItems[0].currentStock).toBe(0);
      expect(alerts.criticalItems[1].variantId).toBe('v-2');
      expect(alerts.criticalItems[1].currentStock).toBe(3);
    });
  });

  describe('getRecentActivity', () => {
    it('returns mapped tickets with item summary and payment label', async () => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
      });

      orderFindMany.mockResolvedValue([
        {
          id: 'order-1',
          invoiceNumber: 'INV-20261031-0001',
          customerName: 'Rahim Khan',
          customerPhone: '01711111111',
          paymentMethod: PaymentMethod.COD,
          totalAmount: 1200,
          status: 'PAID',
          occurredAt: new Date('2026-10-31T08:30:00Z'),
          lines: [
            { productName: 'Polo Shirt', variantName: 'Navy L', quantity: 1 },
          ],
        },
        {
          id: 'order-2',
          invoiceNumber: 'INV-20261031-0002',
          customerName: null,
          customerPhone: null,
          paymentMethod: PaymentMethod.BKASH,
          totalAmount: 2500,
          status: 'PAID',
          occurredAt: new Date('2026-10-31T08:45:00Z'),
          lines: [],
        },
      ]);

      const result = await service.getRecentActivity(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
        limit: 5,
      });

      expect(result.tickets).toHaveLength(2);
      expect(result.tickets[0].paymentLabel).toBe('Cash');
      expect(result.tickets[0].itemsSummary).toBe('Navy L (x1)');
      expect(result.tickets[1].paymentLabel).toBe('bKash');
      expect(result.tickets[1].customerName).toBe('Walk-in Customer');
      expect(result.tickets[1].itemsSummary).toBe('Custom Sale');
    });
  });
});
