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
    shiftSession: { findFirst: shiftSessionFindFirst },
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

  beforeEach(() => {
    jest.clearAllMocks();
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
          businessId: 'biz-unowned',
          locationId: 'loc-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException if location is not in the specified business', async () => {
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.resolveAndValidateScope(adminActor, {
          businessId: 'biz-1',
          locationId: 'loc-invalid',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves valid business and location successfully', async () => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
      });

      const scope = await service.resolveAndValidateScope(adminActor, {
        businessId: 'biz-1',
        locationId: 'loc-1',
      });

      expect(scope).toEqual({
        businessId: 'biz-1',
        locationId: 'loc-1',
        locationName: 'Uttara Branch',
      });
    });
  });

  describe('getOverview', () => {
    beforeEach(() => {
      locationFindFirst.mockResolvedValue({
        id: 'loc-1',
        name: 'Uttara Branch',
      });
    });

    it('returns overview with no active shift when no open shift exists', async () => {
      orderCount.mockResolvedValue(10);
      orderAggregate.mockResolvedValue({ _sum: { totalAmount: 50000 } });
      refundCount.mockResolvedValue(1);
      refundAggregate.mockResolvedValue({ _sum: { totalRefund: 2000 } });
      expenseAggregate.mockResolvedValue({ _sum: { amount: 8000 } });
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
    });

    it('returns overview with active shift drawer metrics', async () => {
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

      shiftSessionFindFirst.mockResolvedValue({
        id: 'shift-1',
        startingAmount: 5000,
        status: ShiftStatus.OPEN,
        openedAt: new Date('2026-10-31T04:00:00Z'),
        cashier: {
          id: 'user-1',
          fullName: 'Tanvir Cashier',
          publicId: 'CSH-0001',
        },
      });

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
