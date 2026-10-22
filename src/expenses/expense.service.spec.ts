import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpenseCategory, Role } from '@prisma/client';
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
    it('creates an expense successfully under the admin business', async () => {
      const mockCreated = {
        id: 'exp-1',
        businessId: 'biz-1',
        locationId: null,
        userId: 'admin-1',
        amount: 5000,
        title: 'Electricity Bill',
        category: ExpenseCategory.UTILITIES,
        note: 'DESCO electricity payment',
        spentAt: new Date('2026-10-15T10:00:00Z'),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        location: null,
        user: { id: 'admin-1', fullName: 'Admin', email: 'admin@suntech.com', role: Role.ADMIN },
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
          }),
        }),
      );
      expect(result.id).toBe('exp-1');
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
    it('soft deletes an expense by setting deletedAt', async () => {
      expenseFindFirst.mockResolvedValue({
        id: 'exp-1',
        businessId: 'biz-1',
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
    it('calculates monthly summary strictly for that month, excluding soft-deleted items and without salary deduction', async () => {
      expenseFindMany.mockResolvedValue([
        {
          id: 'exp-1',
          amount: 10000,
          category: ExpenseCategory.RENT,
          spentAt: new Date('2026-10-05T00:00:00Z'),
        },
        {
          id: 'exp-2',
          amount: 3000,
          category: ExpenseCategory.UTILITIES,
          spentAt: new Date('2026-10-12T00:00:00Z'),
        },
        {
          id: 'exp-3',
          amount: 2000,
          category: ExpenseCategory.UTILITIES,
          spentAt: new Date('2026-10-20T00:00:00Z'),
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
      expect(res.summary.totalExpenses).toBe(15000);
      expect(res.summary.expenseCount).toBe(3);
      expect(res.summary.byCategory).toEqual(
        expect.arrayContaining([
          { category: ExpenseCategory.RENT, total: 10000, count: 1 },
          { category: ExpenseCategory.UTILITIES, total: 5000, count: 2 },
        ]),
      );
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
      expect(res.totalAmount).toBe(15000);
    });
  });
});
