import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AdvanceStatus,
  ExpenseCategory,
  ExpenseSourceType,
  PayrollStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from './payroll.service';

describe('PayrollService', () => {
  const userFindFirst = jest.fn();
  const userFindMany = jest.fn();
  const payrollFindFirst = jest.fn();
  const payrollRecordFindMany = jest.fn();
  const aggregate = jest.fn();
  const updateMany = jest.fn();
  const advanceUpdate = jest.fn();
  const payrollCreate = jest.fn();
  const employeeAdvanceFindMany = jest.fn();
  const expenseCreate = jest.fn();

  const tx = {
    user: { findFirst: userFindFirst, findMany: userFindMany },
    payrollRecord: {
      findFirst: payrollFindFirst,
      findMany: payrollRecordFindMany,
      create: payrollCreate,
    },
    employeeAdvance: {
      aggregate,
      updateMany,
      update: advanceUpdate,
      findMany: employeeAdvanceFindMany,
    },
    expense: {
      create: expenseCreate,
    },
  };
  const transaction = jest.fn((callback: (client: typeof tx) => unknown) =>
    callback(tx),
  );
  const prisma = {
    $transaction: transaction,
    user: { findFirst: userFindFirst, findMany: userFindMany },
    payrollRecord: {
      findFirst: payrollFindFirst,
      findMany: payrollRecordFindMany,
      create: payrollCreate,
    },
    employeeAdvance: {
      aggregate,
      updateMany,
      update: advanceUpdate,
      findMany: employeeAdvanceFindMany,
    },
    expense: {
      create: expenseCreate,
    },
  } as unknown as PrismaService;
  const service = new PayrollService(prisma);
  const dto = { cashierId: 'cashier-1', month: 10, year: 2026 };

  beforeEach(() => {
    userFindFirst.mockReset();
    userFindMany.mockReset();
    payrollFindFirst.mockReset();
    payrollRecordFindMany.mockReset();
    aggregate.mockReset();
    updateMany.mockReset();
    advanceUpdate.mockReset();
    payrollCreate.mockReset();
    employeeAdvanceFindMany.mockReset();
    expenseCreate.mockReset();

    userFindFirst.mockResolvedValue({
      id: 'cashier-1',
      fullName: 'Alex Rivera',
      locationId: 'loc-1',
      monthlySalary: 15000,
    });
    userFindMany.mockResolvedValue([
      {
        id: 'cashier-1',
        fullName: 'Alex Rivera',
        publicId: 'ST-EMP-101',
        role: Role.CASHIER,
        monthlySalary: 35000,
      },
      {
        id: 'cashier-2',
        fullName: 'Tariqul Islam',
        publicId: 'ST-EMP-102',
        role: Role.CASHIER,
        monthlySalary: 24000,
      },
    ]);
    payrollFindFirst.mockResolvedValue(null);
    payrollRecordFindMany.mockResolvedValue([]);
    employeeAdvanceFindMany.mockResolvedValue([]);
    aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    updateMany.mockResolvedValue({ count: 1 });
    advanceUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'adv-1', ...data }),
    );
    payrollCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'payroll-1', ...data }),
    );
  });

  it('pays full salary when cashier took no advances and creates single PAYROLL_NET expense', async () => {
    const paid = await service.process(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      dto,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(advanceUpdate).not.toHaveBeenCalled();
    expect(payrollCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          baseSalary: 15000,
          totalAdvancesDeducted: 0,
          netPaid: 15000,
          status: PayrollStatus.PAID,
        }) as Prisma.PayrollRecordCreateInput,
      }),
    );
    expect(paid).toEqual(
      expect.objectContaining({ netPaid: 15000, totalAdvancesDeducted: 0 }),
    );
    expect(expenseCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        locationId: 'loc-1',
        userId: 'admin-1',
        beneficiaryCashierId: 'cashier-1',
        amount: 15000,
        category: ExpenseCategory.SALARIES,
        sourceType: ExpenseSourceType.PAYROLL_NET,
        payrollId: 'payroll-1',
      }),
    });
  });

  it('Scenario 1: Salary 20k, advances 2k + 3k -> net 15k, deducted 5k, one 15k Expense', async () => {
    userFindFirst.mockResolvedValue({
      id: 'cashier-1',
      fullName: 'Alex Rivera',
      locationId: 'loc-1',
      monthlySalary: 20000,
    });
    employeeAdvanceFindMany.mockResolvedValue([
      { id: 'adv-1', amount: 2000, deductedAmount: 0, takenAt: new Date('2026-10-05') },
      { id: 'adv-2', amount: 3000, deductedAmount: 0, takenAt: new Date('2026-10-12') },
    ]);

    const record = await service.processWithin(
      tx as unknown as Prisma.TransactionClient,
      'biz-1',
      dto,
      'admin-1',
    );

    expect(record.baseSalary).toBe(20000);
    expect(record.totalAdvancesDeducted).toBe(5000);
    expect(record.netPaid).toBe(15000);
    expect(advanceUpdate).toHaveBeenCalledTimes(2);
    expect(advanceUpdate).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: { deductedAmount: 2000, status: AdvanceStatus.DEDUCTED },
    });
    expect(advanceUpdate).toHaveBeenCalledWith({
      where: { id: 'adv-2' },
      data: { deductedAmount: 3000, status: AdvanceStatus.DEDUCTED },
    });
    expect(expenseCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 15000,
        category: ExpenseCategory.SALARIES,
        sourceType: ExpenseSourceType.PAYROLL_NET,
      }),
    });
  });

  it('Scenario 2: Salary 20k, advance 25k -> apply 20k, net 0, remaining 5k carried forward, NO Expense created', async () => {
    userFindFirst.mockResolvedValue({
      id: 'cashier-1',
      fullName: 'Alex Rivera',
      locationId: 'loc-1',
      monthlySalary: 20000,
    });
    employeeAdvanceFindMany.mockResolvedValue([
      { id: 'adv-1', amount: 25000, deductedAmount: 0, takenAt: new Date('2026-10-05') },
    ]);

    const record = await service.processWithin(
      tx as unknown as Prisma.TransactionClient,
      'biz-1',
      dto,
      'admin-1',
    );

    expect(record.baseSalary).toBe(20000);
    expect(record.totalAdvancesDeducted).toBe(20000);
    expect(record.netPaid).toBe(0);
    // Partially deducted: deductedAmount is 20000, status stays PENDING
    expect(advanceUpdate).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: { deductedAmount: 20000, status: AdvanceStatus.PENDING },
    });
    // No zero-amount Expense created
    expect(expenseCreate).not.toHaveBeenCalled();
  });

  it('rejects a second payroll for the same period before changing advances', async () => {
    payrollFindFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.processWithin(
        tx as unknown as Prisma.TransactionClient,
        'biz-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(advanceUpdate).not.toHaveBeenCalled();
    expect(payrollCreate).not.toHaveBeenCalled();
  });

  it('does not pay a cashier from another business', async () => {
    userFindFirst.mockResolvedValue(null);

    await expect(
      service.processWithin(
        tx as unknown as Prisma.TransactionClient,
        'biz-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'cashier-1',
        businessId: 'biz-1',
        role: Role.CASHIER,
        deletedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        locationId: true,
        monthlySalary: true,
      },
    });
    expect(payrollCreate).not.toHaveBeenCalled();
  });

  it('rejects processing payroll for cashier with zero or missing base salary', async () => {
    userFindFirst.mockResolvedValueOnce({
      id: 'cashier-1',
      fullName: 'No Salary Cashier',
      locationId: 'loc-1',
      monthlySalary: 0,
    });

    await expect(
      service.processWithin(
        tx as unknown as Prisma.TransactionClient,
        'biz-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payrollCreate).not.toHaveBeenCalled();
  });

  it('generates payroll summary with metrics and employee status breakdown', async () => {
    employeeAdvanceFindMany.mockResolvedValue([
      { cashierId: 'cashier-1', amount: 1000, deductedAmount: 0, takenAt: new Date('2026-10-10') },
    ]);
    payrollRecordFindMany.mockResolvedValue([
      {
        cashierId: 'cashier-2',
        baseSalary: 24000,
        totalAdvancesDeducted: 0,
        netPaid: 24000,
        createdAt: new Date(),
      },
    ]);

    const res = await service.summary(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026 },
    );

    expect(res.totalStaff).toBe(2);
    expect(res.disbursementStatus).toBe('PARTIAL');
    expect(res.employees).toHaveLength(2);
    expect(res.employees[0].status).toBe('DUE');
    expect(res.employees[0].netPay).toBe(34000); // 35000 - 1000 advance
    expect(res.employees[1].status).toBe('PAID');
    expect(res.employees[1].netPay).toBe(24000);
    expect(res.totalMonthlyPayroll).toBe(58000);
    expect(res.outstandingPayroll).toBe(34000);
    expect(res.totalPaidPayroll).toBe(24000);
  });

  it('preserves historical payroll record in summary even if cashier was later deleted or salary cleared', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'cashier-1',
        fullName: 'Alex Rivera',
        publicId: 'ST-EMP-101',
        role: Role.CASHIER,
        monthlySalary: 35000,
      },
    ]);
    payrollRecordFindMany.mockResolvedValue([
      {
        cashierId: 'cashier-deleted',
        baseSalary: 20000,
        totalAdvancesDeducted: 2000,
        netPaid: 18000,
        createdAt: new Date('2026-10-31'),
        cashier: {
          id: 'cashier-deleted',
          fullName: 'Deleted Employee',
          publicId: 'EMP-DEL',
        },
      },
    ]);

    const res = await service.summary(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026 },
    );

    expect(res.employees).toHaveLength(2);
    const former = res.employees.find((e) => e.id === 'cashier-deleted');
    expect(former).toBeDefined();
    expect(former?.employeeName).toBe('Deleted Employee');
    expect(former?.status).toBe('PAID');
    expect(former?.netPay).toBe(18000);
    expect(res.totalPaidPayroll).toBe(18000);
  });

  it('bulk disburses payroll for pending employees deducting advances', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'cashier-1',
        fullName: 'Alex Rivera',
        locationId: 'loc-1',
        monthlySalary: 35000,
      },
      {
        id: 'cashier-2',
        fullName: 'Tariqul Islam',
        locationId: 'loc-2',
        monthlySalary: 24000,
      },
    ]);
    payrollRecordFindMany.mockResolvedValue([{ cashierId: 'cashier-2' }]);
    employeeAdvanceFindMany.mockResolvedValue([
      { id: 'adv-1', amount: 1000, deductedAmount: 0, takenAt: new Date('2026-10-05') },
    ]);
    updateMany.mockResolvedValue({ count: 1 });

    const res = await service.disburse(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026 },
    );

    expect(res.success).toBe(true);
    expect(res.disbursedCount).toBe(1); // only cashier-1 was pending
    expect(res.alreadyPaidCount).toBe(1);
    expect(advanceUpdate).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: { deductedAmount: 1000, status: AdvanceStatus.DEDUCTED },
    });
    expect(payrollCreate).toHaveBeenCalledTimes(1);
    expect(expenseCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        locationId: 'loc-1',
        userId: 'admin-1',
        amount: 34000, // 35000 - 1000
        category: ExpenseCategory.SALARIES,
        payrollId: 'payroll-1',
      }),
    });
  });

  it('bulk disburses deducting eligible advances up to base salary without creating zero expense', async () => {
    userFindMany.mockResolvedValue([
      { id: 'cashier-1', fullName: 'Alex Rivera', monthlySalary: 35000, locationId: 'loc-1' },
    ]);
    payrollRecordFindMany.mockResolvedValue([]);
    employeeAdvanceFindMany.mockResolvedValue([
      { id: 'adv-1', amount: 40000, deductedAmount: 0, takenAt: new Date('2026-10-05') },
    ]);

    const res = await service.disburse(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026 },
    );

    expect(res.success).toBe(true);
    expect(res.disbursedCount).toBe(1);
    expect(payrollCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseSalary: 35000,
          totalAdvancesDeducted: 35000,
          netPaid: 0,
        }),
      }),
    );
    expect(advanceUpdate).toHaveBeenCalledWith({
      where: { id: 'adv-1' },
      data: { deductedAmount: 35000, status: AdvanceStatus.PENDING },
    });
    expect(expenseCreate).not.toHaveBeenCalled();
  });

  it('filters summary and disburse by locationId', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'cashier-1',
        monthlySalary: 35000,
        fullName: 'Alex',
        role: Role.CASHIER,
      },
    ]);
    payrollRecordFindMany.mockResolvedValue([]);

    await service.summary(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026, locationId: 'loc-branch-1' },
    );

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          locationId: 'loc-branch-1',
        }),
      }),
    );

    await service.disburse(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026, locationId: 'loc-branch-1' },
    );

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          locationId: 'loc-branch-1',
        }),
      }),
    );
  });
});
