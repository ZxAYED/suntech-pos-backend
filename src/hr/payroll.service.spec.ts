import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdvanceStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from './payroll.service';

describe('PayrollService', () => {
  const userFindFirst = jest.fn();
  const userFindMany = jest.fn();
  const payrollFindFirst = jest.fn();
  const payrollRecordFindMany = jest.fn();
  const aggregate = jest.fn();
  const updateMany = jest.fn();
  const payrollCreate = jest.fn();
  const employeeAdvanceFindMany = jest.fn();

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
      findMany: employeeAdvanceFindMany,
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
      findMany: employeeAdvanceFindMany,
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
    payrollCreate.mockReset();
    employeeAdvanceFindMany.mockReset();

    userFindFirst.mockResolvedValue({ id: 'cashier-1', monthlySalary: 15000 });
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
    aggregate.mockResolvedValue({ _sum: { amount: 500 } });
    updateMany.mockResolvedValue({ count: 1 });
    payrollCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'payroll-1', ...data }),
    );
  });

  it('deducts pending advances and records net pay inside one transaction', async () => {
    const paid = await service.process(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      dto,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        businessId: 'biz-1',
        cashierId: 'cashier-1',
        status: AdvanceStatus.PENDING,
        deletedAt: null,
      }) as Prisma.EmployeeAdvanceWhereInput,
      data: { status: AdvanceStatus.DEDUCTED },
    });
    expect(payrollCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          baseSalary: 15000,
          totalAdvancesDeducted: 500,
          netPaid: 14500,
          status: PayrollStatus.PAID,
        }) as Prisma.PayrollRecordCreateInput,
      }),
    );
    expect(paid).toEqual(
      expect.objectContaining({ netPaid: 14500, totalAdvancesDeducted: 500 }),
    );
  });

  it('pays the full salary when the cashier took no advances', async () => {
    aggregate.mockResolvedValue({ _sum: { amount: null } });
    updateMany.mockResolvedValue({ count: 0 });

    await service.processWithin(
      tx as unknown as Prisma.TransactionClient,
      'biz-1',
      dto,
    );

    expect(updateMany).toHaveBeenCalled();
    expect(payrollCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAdvancesDeducted: 0,
          netPaid: 15000,
        }) as Prisma.PayrollRecordCreateInput,
      }),
    );
  });

  it('rejects payroll processing if advances exceed base salary', async () => {
    userFindFirst.mockResolvedValue({ id: 'cashier-1', monthlySalary: 1000 });
    aggregate.mockResolvedValue({ _sum: { amount: 1500 } });

    await expect(
      service.processWithin(
        tx as unknown as Prisma.TransactionClient,
        'biz-1',
        dto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payrollCreate).not.toHaveBeenCalled();
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
    expect(updateMany).not.toHaveBeenCalled();
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
      select: { id: true, monthlySalary: true },
    });
    expect(payrollCreate).not.toHaveBeenCalled();
  });

  it('generates payroll summary with metrics and employee status breakdown', async () => {
    employeeAdvanceFindMany.mockResolvedValue([
      { cashierId: 'cashier-1', amount: 1000 },
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
    expect(res.employees[0].netPay).toBe(34000); // 35000 - 1000
    expect(res.employees[1].status).toBe('PAID');
    expect(res.employees[1].netPay).toBe(24000);
    expect(res.totalMonthlyPayroll).toBe(58000);
  });

  it('bulk disburses payroll for all pending employees', async () => {
    userFindMany.mockResolvedValue([
      { id: 'cashier-1', monthlySalary: 35000 },
      { id: 'cashier-2', monthlySalary: 24000 },
    ]);
    payrollRecordFindMany.mockResolvedValue([{ cashierId: 'cashier-2' }]);
    aggregate.mockResolvedValue({ _sum: { amount: 1000 } });

    const res = await service.disburse(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      { month: 10, year: 2026 },
    );

    expect(res.success).toBe(true);
    expect(res.disbursedCount).toBe(1); // only cashier-1 was pending
    expect(res.alreadyPaidCount).toBe(1);
    expect(payrollCreate).toHaveBeenCalledTimes(1);
  });

  it('throws BadRequestException in disburse if advances exceed base salary', async () => {
    userFindMany.mockResolvedValue([{ id: 'cashier-1', monthlySalary: 35000 }]);
    payrollRecordFindMany.mockResolvedValue([]);
    aggregate.mockResolvedValue({ _sum: { amount: 40000 } });

    await expect(
      service.disburse(
        { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
        { month: 10, year: 2026 },
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Total advances (40000) cannot exceed base salary (35000)',
      ),
    );
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
