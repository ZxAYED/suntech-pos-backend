import { Role } from '@prisma/client';
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
  const prisma = {
    order: { aggregate: orderAggregate, groupBy: orderGroupBy },
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
    orderAggregate.mockResolvedValue({ _sum: { totalAmount: 1500 } });
    refundAggregate.mockResolvedValue({ _sum: { totalRefund: 500 } });
    orderItemAggregate.mockResolvedValue({ _sum: { quantity: 4 } });
    refundItemAggregate.mockResolvedValue({ _sum: { quantity: 1 } });
  });

  it('returns a cashier dashboard net of refunds for that cashier only', async () => {
    const dashboard = await service.dashboard({
      sub: 'cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-1',
    });

    expect(dashboard).toEqual({
      myDailyRevenue: 1000,
      myDailyUnitsSold: 3,
      myMonthlyRevenue: 1000,
    });
    expect(orderAggregate).toHaveBeenCalledWith({
      where: {
        cashierId: 'cashier-1',
        cashier: { businessId: 'biz-1' },
        createdAt: expect.any(Object) as object,
      },
      _sum: { totalAmount: true },
    });
  });

  it('ranks staff by this month revenue after refunds', async () => {
    orderGroupBy.mockResolvedValue([
      { cashierId: 'cashier-1', _sum: { totalAmount: 2000 } },
      { cashierId: 'cashier-2', _sum: { totalAmount: 500 } },
    ]);
    refundFindMany.mockResolvedValue([
      { totalRefund: 500, order: { cashierId: 'cashier-1' } },
    ]);
    userFindMany.mockResolvedValue([
      { id: 'cashier-1', fullName: 'Rafi', publicId: 'CSH-RAFI1' },
      { id: 'cashier-2', fullName: 'Mina', publicId: 'CSH-MINA1' },
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
    expect(orderGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['cashierId'],
        where: expect.objectContaining({
          cashier: { businessId: 'biz-1', role: Role.CASHIER, deletedAt: null },
        }) as object,
      }),
    );
  });
});
