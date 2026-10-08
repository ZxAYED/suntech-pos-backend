import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdvanceStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from './payroll.service';

describe('PayrollService', () => {
  const userFindFirst = jest.fn();
  const payrollFindFirst = jest.fn();
  const aggregate = jest.fn();
  const updateMany = jest.fn();
  const payrollCreate = jest.fn();
  const tx = {
    user: { findFirst: userFindFirst },
    payrollRecord: { findFirst: payrollFindFirst, create: payrollCreate },
    employeeAdvance: { aggregate, updateMany },
  };
  const transaction = jest.fn((callback: (client: typeof tx) => unknown) =>
    callback(tx),
  );
  const prisma = {
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new PayrollService(prisma);
  const dto = { cashierId: 'cashier-1', month: 10, year: 2026 };

  beforeEach(() => {
    userFindFirst.mockReset();
    payrollFindFirst.mockReset();
    aggregate.mockReset();
    updateMany.mockReset();
    payrollCreate.mockReset();
    userFindFirst.mockResolvedValue({ id: 'cashier-1', monthlySalary: 15000 });
    payrollFindFirst.mockResolvedValue(null);
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

  it('allows a negative net when advances exceed salary', async () => {
    userFindFirst.mockResolvedValue({ id: 'cashier-1', monthlySalary: 1000 });
    aggregate.mockResolvedValue({ _sum: { amount: 1500 } });

    await service.processWithin(
      tx as unknown as Prisma.TransactionClient,
      'biz-1',
      dto,
    );

    expect(payrollCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          netPaid: -500,
        }) as Prisma.PayrollRecordCreateInput,
      }),
    );
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
});
