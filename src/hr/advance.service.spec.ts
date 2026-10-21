import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AdvanceStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdvanceService } from './advance.service';

describe('AdvanceService', () => {
  const userFindFirst = jest.fn();
  const advanceCreate = jest.fn();
  const advanceFindMany = jest.fn();
  const advanceFindFirst = jest.fn();
  const advanceUpdateMany = jest.fn();
  const prisma = {
    user: { findFirst: userFindFirst },
    employeeAdvance: {
      create: advanceCreate,
      findMany: advanceFindMany,
      findFirst: advanceFindFirst,
      updateMany: advanceUpdateMany,
    },
  } as unknown as PrismaService;
  const service = new AdvanceService(prisma);

  beforeEach(() => {
    userFindFirst.mockReset();
    advanceCreate.mockReset();
    advanceFindMany.mockReset();
    advanceFindFirst.mockReset();
    advanceUpdateMany.mockReset();
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

  it('lists advances for a cashier locked to their own id and location', async () => {
    advanceFindMany.mockResolvedValue([
      {
        id: 'adv-1',
        cashierId: 'cashier-1',
        amount: 1000,
        reason: 'Medical',
        status: AdvanceStatus.PENDING,
        takenAt: new Date('2026-10-01'),
        createdAt: new Date('2026-10-01'),
        cashier: {
          fullName: 'Alex Rivera',
          publicId: 'CSH-0001',
          role: Role.CASHIER,
          location: { name: 'Main Branch' },
        },
      },
    ]);

    const res = await service.list(
      {
        sub: 'cashier-1',
        role: Role.CASHIER,
        businessId: 'biz-1',
        locationId: 'loc-1',
      },
      {},
    );

    expect(advanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          cashierId: 'cashier-1',
          cashier: { locationId: 'loc-1' },
        }),
      }),
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toEqual({
      id: 'adv-1',
      cashierId: 'cashier-1',
      employeeName: 'Alex Rivera',
      employeeCode: 'CSH-0001',
      role: Role.CASHIER,
      locationName: 'Main Branch',
      amount: 1000,
      reason: 'Medical',
      status: AdvanceStatus.PENDING,
      takenAt: expect.any(Date),
      createdAt: expect.any(Date),
    });
    expect(res.summary).toEqual({
      totalActiveAdvances: 1000,
      pendingCount: 1,
      deductedCount: 0,
    });
  });

  it('lists advances for admin with multi-filters and summary counts', async () => {
    advanceFindMany.mockResolvedValue([
      {
        id: 'adv-1',
        cashierId: 'c1',
        amount: 1000,
        reason: 'Emergency',
        status: AdvanceStatus.PENDING,
        takenAt: new Date('2026-10-01'),
        createdAt: new Date('2026-10-01'),
        cashier: {
          fullName: 'Tariqul',
          publicId: null,
          role: Role.CASHIER,
          location: { name: 'Uttara Branch' },
        },
      },
      {
        id: 'adv-2',
        cashierId: 'c2',
        amount: 500,
        reason: 'Transport',
        status: AdvanceStatus.DEDUCTED,
        takenAt: new Date('2026-10-02'),
        createdAt: new Date('2026-10-02'),
        cashier: {
          fullName: 'Mina',
          publicId: 'CSH-0002',
          role: Role.CASHIER,
          location: { name: 'Uttara Branch' },
        },
      },
    ]);

    const res = await service.list(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      {
        locationId: 'loc-uttara',
        status: AdvanceStatus.PENDING,
        month: 10,
        year: 2026,
      },
    );

    expect(advanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          status: AdvanceStatus.PENDING,
          cashier: { locationId: 'loc-uttara' },
          takenAt: expect.any(Object),
        }),
      }),
    );
    expect(res.items).toHaveLength(2);
    expect(res.items[0].employeeCode).toBe('CSH-c1');
    expect(res.summary).toEqual({
      totalActiveAdvances: 1000,
      pendingCount: 1,
      deductedCount: 1,
    });
  });

  it('rejects an advance when requested amount exceeds remaining monthly salary', async () => {
    userFindFirst.mockResolvedValue({ id: 'cashier-1', monthlySalary: 10000 });
    advanceFindMany.mockResolvedValue([{ amount: 7000 }]);

    await expect(
      service.create(
        {
          sub: 'cashier-1',
          role: Role.CASHIER,
          businessId: 'biz-1',
        },
        { amount: 4000, reason: 'Over limit' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('remove', () => {
    it('throws BadRequestException when trying to delete an already deducted advance', async () => {
      advanceFindFirst.mockResolvedValue({
        id: 'adv-1',
        status: AdvanceStatus.DEDUCTED,
      });

      await expect(
        service.remove(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'adv-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('soft deletes a pending advance', async () => {
      advanceFindFirst.mockResolvedValue({
        id: 'adv-1',
        status: AdvanceStatus.PENDING,
      });
      advanceUpdateMany.mockResolvedValue({ count: 1 });

      const res = await service.remove(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        'adv-1',
      );

      expect(advanceUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'adv-1',
          businessId: 'biz-1',
          status: AdvanceStatus.PENDING,
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(res.id).toBe('adv-1');
    });

    it('throws NotFoundException when advance to delete is not found', async () => {
      advanceFindFirst.mockResolvedValue(null);

      await expect(
        service.remove(
          { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
          'non-existent',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
