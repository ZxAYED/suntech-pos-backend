import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseCategory, ExpenseSourceType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExpenseService } from './expense.service';

describe('ExpenseService', () => {
  let service: ExpenseService;
  let prisma: PrismaService;

  const expenseCreate = jest.fn();
  const expenseFindFirst = jest.fn();
  const expenseFindMany = jest.fn();
  const expenseUpdate = jest.fn();
  const locationFindFirst = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      expense: {
        create: expenseCreate,
        findFirst: expenseFindFirst,
        findMany: expenseFindMany,
        update: expenseUpdate,
      },
      location: {
        findFirst: locationFindFirst,
      },
    } as unknown as PrismaService;

    service = new ExpenseService(prisma);
  });

  describe('create', () => {
    it('creates a MANUAL expense successfully under the admin business', async () => {
      const mockCreated = {
        id: 'exp-1',
        businessId: 'biz-1',
        locationId: null,
        userId: 'admin-1',
        beneficiaryCashierId: null,
        amount: 5000,
        title: 'Electricity Bill',
        category: ExpenseCategory.UTILITIES,
        sourceType: ExpenseSourceType.MANUAL,
        note: 'DESCO electricity payment',
        spentAt: new Date('2026-10-15T10:00:00Z'),
        paidAt: null,
        advanceId: null,
        payrollId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        location: null,
        beneficiaryCashier: null,
        user: {
          id: 'admin-1',
          fullName: 'Admin',
          email: 'admin@suntech.com',
          role: Role.ADMIN,
        },
      };

      expenseCreate.mockResolvedValue(mockCreated);

      const result = await service.create(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        {
          amount: 5000,
          title: 'Electricity Bill',
          category: ExpenseCategory.UTILITIES,
          note: 'DESCO electricity payment',
          spentAt: '2026-10-15T10:00:00.000Z',
          businessId: 'biz-1',
        },
      );

      expect(expenseCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz-1',
            userId: 'admin-1',
            amount: 5000,
            title: 'Electricity Bill',
            category: ExpenseCategory.UTILITIES,
            sourceType: ExpenseSourceType.MANUAL,
          }),
        }),
      );
      expect(result.id).toBe('exp-1');
      expect(result.type).toBe(ExpenseSourceType.MANUAL);
      expect(result.sourceType).toBe(ExpenseSourceType.MANUAL);
    });

    it('validates branch location and throws NotFoundException if location not found', async () => {
      locationFindFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
          {
            amount: 2000,
            title: 'Cleaning supplies',
            locationId: 'loc-invalid',
            businessId: 'biz-1',
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException if admin does not own requested business', async () => {
      await expect(
        service.create(
          { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
          {
            amount: 1000,
            title: 'Stationery',
            businessId: 'biz-other',
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('soft deletes a MANUAL expense by setting deletedAt', async () => {
      expenseFindFirst.mockResolvedValue({
        id: 'exp-1',
        businessId: 'biz-1',
        sourceType: ExpenseSourceType.MANUAL,
        advanceId: null,
        payrollId: null,
        deletedAt: null,
      });
      expenseUpdate.mockResolvedValue({ id: 'exp-1' });

      const result = await service.remove(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        'exp-1',
        'biz-1',
      );

      expect(expenseUpdate).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.id).toBe('exp-1');
      expect(result.deletedAt).toBeInstanceOf(Date);
    });

    it('throws BadRequestException when attempting to delete a SALARY_ADVANCE projection', async () => {
      expenseFindFirst.mockResolvedValue({
        id: 'exp-adv',
        businessId: 'biz-1',
        sourceType: ExpenseSourceType.SALARY_ADVANCE,
        advanceId: 'adv-123',
        payrollId: null,
        deletedAt: null,
      });

      await expect(
        service.remove(
          { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
          'exp-adv',
          'biz-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(expenseUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when attempting to delete a PAYROLL_NET projection', async () => {
      expenseFindFirst.mockResolvedValue({
        id: 'exp-pr',
        businessId: 'biz-1',
        sourceType: ExpenseSourceType.PAYROLL_NET,
        advanceId: null,
        payrollId: 'pr-123',
        deletedAt: null,
      });

      await expect(
        service.remove(
          { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
          'exp-pr',
          'biz-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(expenseUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if expense is not found or already deleted', async () => {
      expenseFindFirst.mockResolvedValue(null);

      await expect(
        service.remove(
          { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
          'exp-nonexistent',
          'biz-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('summary', () => {
    it('calculates monthly summary with byCategory and byType breakdowns', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-1',
          amount: 10000,
          category: ExpenseCategory.RENT,
          sourceType: ExpenseSourceType.MANUAL,
          spentAt: new Date('2026-10-05T00:00:00Z'),
        },
        {
          id: 'exp-2',
          amount: 3000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.SALARY_ADVANCE,
          spentAt: new Date('2026-10-12T00:00:00Z'),
        },
        {
          id: 'exp-3',
          amount: 12000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.PAYROLL_NET,
          spentAt: new Date('2026-10-31T00:00:00Z'),
        },
      ]);

      const res = await service.summary(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        { month: 10, year: 2026, businessId: 'biz-1' },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz-1',
            deletedAt: null,
            spentAt: expect.any(Object),
          }),
        }),
      );

      expect(res.month).toBe(10);
      expect(res.year).toBe(2026);
      expect(res.summary.totalExpenses).toBe(25000);
      expect(res.summary.expenseCount).toBe(3);
      expect(res.summary.byCategory).toEqual(
        expect.arrayContaining([
          { category: ExpenseCategory.RENT, total: 10000, count: 1 },
          { category: ExpenseCategory.SALARIES, total: 15000, count: 2 },
        ]),
      );
      expect(res.summary.byType).toEqual(
        expect.arrayContaining([
          { type: ExpenseSourceType.MANUAL, total: 10000, count: 1 },
          { type: ExpenseSourceType.SALARY_ADVANCE, total: 3000, count: 1 },
          { type: ExpenseSourceType.PAYROLL_NET, total: 12000, count: 1 },
        ]),
      );
    });

    it('filters summary independently by type', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-2',
          amount: 3000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.SALARY_ADVANCE,
          spentAt: new Date('2026-10-12T00:00:00Z'),
        },
      ]);

      const res = await service.summary(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        {
          month: 10,
          year: 2026,
          businessId: 'biz-1',
          type: ExpenseSourceType.SALARY_ADVANCE,
        },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz-1',
            sourceType: ExpenseSourceType.SALARY_ADVANCE,
            deletedAt: null,
          }),
        }),
      );
      expect(res.summary.totalExpenses).toBe(3000);
      expect(res.summary.expenseCount).toBe(1);
      expect(res.summary.byType).toEqual([
        { type: ExpenseSourceType.SALARY_ADVANCE, total: 3000, count: 1 },
      ]);
    });

    it('filters summary independently by category', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-2',
          amount: 3000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.SALARY_ADVANCE,
          spentAt: new Date('2026-10-12T00:00:00Z'),
        },
        {
          id: 'exp-3',
          amount: 12000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.PAYROLL_NET,
          spentAt: new Date('2026-10-31T00:00:00Z'),
        },
      ]);

      const res = await service.summary(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        {
          month: 10,
          year: 2026,
          businessId: 'biz-1',
          category: ExpenseCategory.SALARIES,
        },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz-1',
            category: ExpenseCategory.SALARIES,
            deletedAt: null,
          }),
        }),
      );
      expect(res.summary.totalExpenses).toBe(15000);
      expect(res.summary.expenseCount).toBe(2);
    });

    it('isolates summary strictly to requested locationId', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-1',
          amount: 1000,
          category: ExpenseCategory.TRANSPORT,
          sourceType: ExpenseSourceType.MANUAL,
          spentAt: new Date('2026-10-31T11:58:00Z'),
          locationId: 'loc-1',
        },
        {
          id: 'exp-2',
          amount: 2000,
          category: ExpenseCategory.OTHER,
          sourceType: ExpenseSourceType.MANUAL,
          spentAt: new Date('2026-10-31T11:57:00Z'),
          locationId: 'loc-1',
        },
      ]);

      const res = await service.summary(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        { month: 10, year: 2026, businessId: 'biz-1', locationId: 'loc-1' },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz-1',
            locationId: 'loc-1',
            deletedAt: null,
          }),
        }),
      );
      expect(res.summary.totalExpenses).toBe(3000);
      expect(res.summary.expenseCount).toBe(2);
      expect(res.items).toHaveLength(2);
    });

    it('returns 0 totalExpenses when no records exist for the branch', async () => {
      expenseFindMany.mockResolvedValue([]);

      const res = await service.summary(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        { month: 10, year: 2026, businessId: 'biz-1', locationId: 'loc-empty' },
      );

      expect(res.summary.totalExpenses).toBe(0);
      expect(res.summary.expenseCount).toBe(0);
      expect(res.summary.byCategory).toEqual([]);
      expect(res.summary.byType).toEqual([]);
      expect(res.items).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('lists active expenses with keyword filtering and sum aggregation', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-1',
          title: 'Office Rent',
          amount: 15000,
          category: ExpenseCategory.RENT,
          sourceType: ExpenseSourceType.MANUAL,
        },
      ]);

      const res = await service.list(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        { businessId: 'biz-1', search: 'Rent' },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz-1',
            deletedAt: null,
            OR: expect.arrayContaining([
              { title: { contains: 'Rent', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0].type).toBe(ExpenseSourceType.MANUAL);
      expect(res.items[0].sourceType).toBe(ExpenseSourceType.MANUAL);
      expect(res.totalAmount).toBe(15000);
    });

    it('supports independent type filter and category filter', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-adv-1',
          title: 'Salary Advance - Alex Rivera',
          amount: 2000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.SALARY_ADVANCE,
        },
      ]);

      const res = await service.list(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        {
          businessId: 'biz-1',
          type: ExpenseSourceType.SALARY_ADVANCE,
          category: ExpenseCategory.SALARIES,
        },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz-1',
            sourceType: ExpenseSourceType.SALARY_ADVANCE,
            category: ExpenseCategory.SALARIES,
            deletedAt: null,
          }),
        }),
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0].type).toBe(ExpenseSourceType.SALARY_ADVANCE);
    });

    it('omits sourceType in where when no type filter is supplied so all types appear together', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-1',
          title: 'Desk',
          amount: 500,
          category: ExpenseCategory.OFFICE,
          sourceType: ExpenseSourceType.MANUAL,
        },
        {
          id: 'exp-2',
          title: 'Salary Advance - Alex',
          amount: 1000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.SALARY_ADVANCE,
        },
        {
          id: 'exp-3',
          title: 'Payroll - Alex',
          amount: 14000,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.PAYROLL_NET,
        },
      ]);

      const res = await service.list(
        { sub: 'admin-1', role: Role.ADMIN, businessIds: ['biz-1'] },
        { businessId: 'biz-1' },
      );

      expect(expenseFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            sourceType: expect.anything(),
          }),
        }),
      );
      expect(res.items).toHaveLength(3);
      expect(res.totalAmount).toBe(15500);
    });
  });
});
