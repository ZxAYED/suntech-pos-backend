import { PaymentMethod, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminDashboard, ReportService } from './report.service';

describe('ReportService', () => {
  const orderAggregate = jest.fn();
  const refundAggregate = jest.fn();
  const orderItemAggregate = jest.fn();
  const refundItemAggregate = jest.fn();
  const orderGroupBy = jest.fn();
  const refundFindMany = jest.fn();
  const userFindMany = jest.fn();
  const orderCount = jest.fn();
  const orderFindMany = jest.fn();
  const orderLineFindMany = jest.fn();

  const prisma = {
    order: {
      aggregate: orderAggregate,
      groupBy: orderGroupBy,
      count: orderCount,
      findMany: orderFindMany,
    },
    orderLine: {
      aggregate: orderItemAggregate,
      findMany: orderLineFindMany,
    },
    refund: { aggregate: refundAggregate, findMany: refundFindMany },
    orderItem: { aggregate: orderItemAggregate },
    refundItem: { aggregate: refundItemAggregate },
    user: { findMany: userFindMany },
  } as unknown as PrismaService;
  const service = new ReportService(prisma);

  beforeEach(() => {
    orderAggregate.mockReset();
    refundAggregate.mockReset();
    orderItemAggregate.mockReset();
    refundItemAggregate.mockReset();
    orderGroupBy.mockReset();
    refundFindMany.mockReset();
    userFindMany.mockReset();
    orderCount.mockReset();
    orderFindMany.mockReset();
    orderLineFindMany.mockReset();

    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 1500 } });
    refundAggregate.mockResolvedValue({ _sum: { totalRefund: 500 } });
    orderItemAggregate.mockResolvedValue({ _sum: { quantity: 4 } });
    refundItemAggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    orderCount.mockResolvedValue(10);
    orderFindMany.mockResolvedValue([]);
    orderLineFindMany.mockResolvedValue([]);
  });

  it('returns a cashier dashboard net of refunds for that cashier only', async () => {
    const dashboard = await service.dashboard({
      sub: 'cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-1',
      locationId: 'loc-1',
    });

    expect(dashboard).toEqual({
      myDailyRevenue: 1000,
      myDailyUnitsSold: 3,
      myDailyOrdersCount: 10,
      myMonthlyRevenue: 1000,
    });
    expect(orderAggregate).toHaveBeenCalledWith({
      where: {
        cashierId: 'cashier-1',
        cashier: { businessId: 'biz-1' },
        locationId: 'loc-1',
        occurredAt: expect.any(Object) as object,
      },
      _sum: { totalAmount: true },
    });
  });

  it('ranks staff by this month revenue after refunds and returns period metrics', async () => {
    orderGroupBy.mockImplementation(({ by }: { by: string[] }) => {
      if (by.includes('cashierId')) {
        return Promise.resolve([
          { cashierId: 'cashier-1', _sum: { totalAmount: 2000 } },
          { cashierId: 'cashier-2', _sum: { totalAmount: 500 } },
        ]);
      }
      if (by.includes('paymentMethod')) {
        return Promise.resolve([
          { paymentMethod: PaymentMethod.COD, _sum: { totalAmount: 600 } },
          { paymentMethod: PaymentMethod.BKASH, _sum: { totalAmount: 400 } },
        ]);
      }
      return Promise.resolve([]);
    });

    refundFindMany.mockResolvedValue([
      { totalRefund: 500, order: { cashierId: 'cashier-1' } },
    ]);
    userFindMany.mockResolvedValue([
      { id: 'cashier-1', fullName: 'Rafi', publicId: 'CSH-RAFI1' },
      { id: 'cashier-2', fullName: 'Mina', publicId: 'CSH-MINA1' },
    ]);
    orderCount.mockResolvedValue(2);
    orderLineFindMany.mockResolvedValue([
      {
        subtotal: 800,
        quantity: 2,
        variantId: 'var-1',
        variant: {
          costPrice: 300,
          product: { category: { name: 'Smartphones' } },
        },
      },
      {
        subtotal: 200,
        quantity: 1,
        variantId: 'var-2',
        variant: {
          costPrice: 100,
          product: { category: { name: 'Accessories' } },
        },
      },
    ]);
    orderFindMany.mockResolvedValue([
      {
        id: 'ord-1',
        invoiceNumber: 'INV-001',
        customerName: 'Customer A',
        paymentMethod: PaymentMethod.COD,
        totalAmount: 500,
        status: 'PAID',
        occurredAt: new Date(),
        lines: [{ productName: 'Item A', variantName: 'Var A', quantity: 1 }],
      },
    ]);

    const dashboard = (await service.dashboard({
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
    })) as AdminDashboard;

    expect(dashboard.globalDailyRevenue).toBe(1000);
    expect(dashboard.globalRolling30DayRevenue).toBe(1000);
    expect(dashboard.staffLeaderboard).toEqual([
      {
        cashierId: 'cashier-1',
        fullName: 'Rafi',
        publicId: 'CSH-RAFI1',
        revenue: 1500,
      },
      {
        cashierId: 'cashier-2',
        fullName: 'Mina',
        publicId: 'CSH-MINA1',
        revenue: 500,
      },
    ]);
    expect(dashboard.periodRevenue).toBe(1000);
    expect(dashboard.ordersCount).toBe(2);
    expect(dashboard.averageTicketValue).toBe(500); // 1000 / 2
    // grossMargin: catalogRevenue = 1000, catalogCost = 300*2 + 100*1 = 700. (1000-700)/1000 * 100 = 30%
    expect(dashboard.grossMarginPercent).toBe(30);
    expect(dashboard.paymentBreakdown).toEqual({
      cashAmount: 600,
      digitalAmount: 400,
      cashPercentage: 60,
      digitalPercentage: 40,
      byMethod: {
        COD: 600,
        BKASH: 400,
        NAGAD: 0,
        BANK: 0,
      },
    });
    expect(dashboard.topCategories).toEqual([
      { name: 'Smartphones', revenue: 800, percentage: 80 },
      { name: 'Accessories', revenue: 200, percentage: 20 },
    ]);
    expect(dashboard.recentTickets).toHaveLength(1);
    expect(dashboard.recentTickets[0]).toEqual(
      expect.objectContaining({
        id: 'ord-1',
        invoiceNumber: 'INV-001',
        customerName: 'Customer A',
        itemsSummary: 'Var A (x1)',
      }),
    );
  });

  it('computes period analytics for admin', async () => {
    orderCount.mockResolvedValue(5);
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 10000 } });
    refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
    orderGroupBy.mockResolvedValue([
      { paymentMethod: PaymentMethod.COD, _sum: { totalAmount: 7000 } },
      { paymentMethod: PaymentMethod.BKASH, _sum: { totalAmount: 3000 } },
    ]);
    orderLineFindMany.mockResolvedValue([
      {
        subtotal: 10000,
        quantity: 10,
        variantId: 'var-1',
        variant: {
          costPrice: 750,
          product: { category: { name: 'Gadgets' } },
        },
      },
    ]);

    const res = await service.analytics(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { range: 'weekly' },
    );

    expect(res.grossRevenue).toBe(10000);
    expect(res.ordersCount).toBe(5);
    expect(res.averageTicketValue).toBe(2000);
    // (10000 - 7500) / 10000 * 100 = 25%
    expect(res.grossMarginPercent).toBe(25);
    expect(res.cashPercentage).toBe(70);
    expect(res.digitalPercentage).toBe(30);
    expect(res.topCategories).toEqual([
      { name: 'Gadgets', revenue: 10000, percentage: 100 },
    ]);
  });

  it('subtracts partial refunds from line items when computing metrics', async () => {
    orderCount.mockResolvedValue(1);
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 1000 } });
    refundAggregate.mockResolvedValue({ _sum: { totalRefund: 400 } });
    orderGroupBy.mockResolvedValue([
      { paymentMethod: PaymentMethod.COD, _sum: { totalAmount: 600 } },
    ]);
    orderLineFindMany.mockResolvedValue([
      {
        unitPrice: 400,
        subtotal: 800,
        quantity: 2,
        variantId: 'var-1',
        refundItems: [{ quantity: 1, refundAmount: 400 }],
        variant: {
          costPrice: 200,
          product: { category: { name: 'Smartphones' } },
        },
      },
    ]);

    const res = await service.analytics(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { range: 'daily' },
    );

    // periodRevenue is 1000 - 400 = 600
    expect(res.grossRevenue).toBe(600);
    // net line: subtotal = 800 - 400 = 400, quantity = 2 - 1 = 1
    // catalogRevenue = 400, catalogCost = 200 * 1 = 200
    // grossMarginPercent = (400 - 200) / 400 * 100 = 50%
    expect(res.grossMarginPercent).toBe(50);
    expect(res.topCategories).toEqual([
      { name: 'Smartphones', revenue: 400, percentage: 100 },
    ]);
  });

  it('filters transactions with location and search', async () => {
    orderCount.mockResolvedValue(1);
    orderFindMany.mockResolvedValue([
      {
        id: 'ord-1',
        invoiceNumber: 'INV-999',
        receiptNumber: 'REC-999',
        orderType: 'CATALOG',
        status: 'PAID',
        customerName: 'Karim',
        customerPhone: '01700000000',
        customerNumber: '01700000000',
        totalAmount: 1200,
        subtotal: 1200,
        tenderedAmount: 1500,
        changeDue: 300,
        paymentMethod: 'COD',
        createdAt: new Date(),
        cashier: { id: 'c1', fullName: 'Cashier 1', publicId: 'CSH-001' },
        lines: [
          {
            id: 'l1',
            variantId: 'v1',
            productName: 'P1',
            variantName: 'V1',
            unitPrice: 1200,
            quantity: 1,
            subtotal: 1200,
          },
        ],
      },
    ]);

    const res = await service.transactions(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { locationId: 'loc-1', search: 'Karim', range: 'monthly' },
    );

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].invoiceNumber).toBe('INV-999');
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          locationId: 'loc-1',
          cashier: { businessId: 'biz-1' },
          OR: expect.arrayContaining([
            { customerName: { contains: 'Karim', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  it('computes period analytics for admin filtered by month name or code', async () => {
    orderCount.mockResolvedValue(3);
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 6000 } });
    refundAggregate.mockResolvedValue({ _sum: { totalRefund: 0 } });
    orderGroupBy.mockResolvedValue([
      { paymentMethod: PaymentMethod.COD, _sum: { totalAmount: 6000 } },
    ]);
    orderLineFindMany.mockResolvedValue([
      {
        subtotal: 6000,
        quantity: 3,
        variantId: 'var-1',
        variant: {
          costPrice: 1000,
          product: { category: { name: 'Electronics' } },
        },
      },
    ]);

    const res = await service.analytics(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 'october', year: 2026 },
    );

    expect(res.grossRevenue).toBe(6000);
    expect(res.ordersCount).toBe(3);
    expect(res.averageTicketValue).toBe(2000);
    expect(res.topCategories).toEqual([
      { name: 'Electronics', revenue: 6000, percentage: 100 },
    ]);
  });

  it('supports dashboard metrics filtered by range="month"', async () => {
    orderGroupBy.mockImplementation(({ by }: { by: string[] }) => {
      if (by.includes('cashierId')) {
        return Promise.resolve([
          { cashierId: 'cashier-1', _sum: { totalAmount: 1000 } },
        ]);
      }
      return Promise.resolve([]);
    });
    userFindMany.mockResolvedValue([
      { id: 'cashier-1', fullName: 'Rafi', publicId: 'CSH-RAFI1' },
    ]);
    orderCount.mockResolvedValue(1);
    orderLineFindMany.mockResolvedValue([]);
    orderFindMany.mockResolvedValue([]);

    const dashboard = (await service.dashboard(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { range: 'month', month: 'oct' },
    )) as AdminDashboard;

    expect(dashboard.periodRevenue).toBe(1000);
    expect(dashboard.ordersCount).toBe(1);
  });

  it('supports transactions filtered by month and year', async () => {
    orderCount.mockResolvedValue(1);
    orderFindMany.mockResolvedValue([
      {
        id: 'ord-oct',
        invoiceNumber: 'INV-OCT',
        paymentMethod: PaymentMethod.COD,
        totalAmount: 1500,
        subtotal: 1500,
        tenderedAmount: 1500,
        changeDue: 0,
        status: 'PAID',
        createdAt: new Date(),
        cashier: { id: 'c1', fullName: 'Cashier 1', publicId: 'C1' },
        lines: [],
      },
    ]);

    const res = await service.transactions(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: '10', year: 2026 },
    );

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cashier: { businessId: 'biz-1' },
          occurredAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });
});
