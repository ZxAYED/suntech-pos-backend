import { ForbiddenException } from '@nestjs/common';
import { AdvanceStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdvanceService } from './advance.service';

describe('AdvanceService', () => {
  const userFindFirst = jest.fn();
  const advanceCreate = jest.fn();
  const advanceFindMany = jest.fn();
  const prisma = {
    user: { findFirst: userFindFirst },
    employeeAdvance: { create: advanceCreate, findMany: advanceFindMany },
  } as unknown as PrismaService;
  const service = new AdvanceService(prisma);

  beforeEach(() => {
    userFindFirst.mockReset();
    advanceCreate.mockReset();
    advanceFindMany.mockReset();
    userFindFirst.mockResolvedValue({ id: 'cashier-1', monthlySalary: 15000 });
    advanceCreate.mockResolvedValue({ id: 'advance-1' });
  });

  it('forces a cashier advance onto their own user id', async () => {
    await service.create(
      {
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
      },
      { amount: 500, cashierId: 'someone-else', reason: 'Transport' },
    );

    expect(advanceCreate).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        cashierId: 'cashier-1',
        amount: 500,
        reason: 'Transport',
        status: AdvanceStatus.PENDING,
      },
      select: {
        id: true,
        cashierId: true,
        amount: true,
        reason: true,
        status: true,
        takenAt: true,
        createdAt: true,
      },
    });
  });

  it('calculates net payable from pending advances in the requested month', async () => {
    advanceFindMany.mockResolvedValue([
      { id: 'a1', amount: 200 },
      { id: 'a2', amount: 300 },
    ]);

    const summary = await service.summary(
      { sub: 'cashier-1', role: Role.CASHIER, businessId: 'biz-1' },
      { month: 10, year: 2026 },
    );

    expect(advanceFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        cashierId: 'cashier-1',
        status: AdvanceStatus.PENDING,
        deletedAt: null,
        takenAt: {
          gte: new Date(Date.UTC(2026, 9, 1)),
          lt: new Date(Date.UTC(2026, 10, 1)),
        },
      },
      select: {
        id: true,
        cashierId: true,
        amount: true,
        reason: true,
        status: true,
        takenAt: true,
        createdAt: true,
      },
      orderBy: { takenAt: 'desc' },
    });
    expect(summary.summary).toEqual({
      baseSalary: 15000,
      totalPendingAdvances: 500,
      netPayable: 14500,
    });
  });

  it('refuses a cashier summary for another cashier', async () => {
    await expect(
      service.summary(
        { sub: 'cashier-1', role: Role.CASHIER, businessId: 'biz-1' },
        { cashierId: 'cashier-2', month: 10, year: 2026 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(advanceFindMany).not.toHaveBeenCalled();
  });
});
