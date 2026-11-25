import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { getDhakaDateParts } from '../common/utils/timezone.util';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { PrismaService } from '../prisma/prisma.service';
import { DisbursePayrollDto } from './dto/disburse-payroll.dto';
import { PayrollHistoryQueryDto } from './dto/payroll-history.query';
import { ProcessPayrollDto } from './dto/process-payroll.dto';
import { payrollPeriod } from './payroll-period';
import { requireBusinessId } from './require-business-id';

const payrollSelect = {
  id: true,
  cashierId: true,
  month: true,
  year: true,
  baseSalary: true,
  totalAdvancesDeducted: true,
  netPaid: true,
  status: true,
  createdAt: true,
  cashier: {
    select: {
      id: true,
      fullName: true,
      publicId: true,
    },
  },
  advanceDeductions: {
    select: {
      id: true,
      advanceId: true,
      amount: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PayrollRecordSelect;

export type PresentedPayroll = Prisma.PayrollRecordGetPayload<{
  select: typeof payrollSelect;
}> & {
  autoClosedPreviousShiftId?: string;
};

const ALREADY_PAID = 'Payroll for this cashier and period already exists';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async process(
    admin: AccessTokenPayload,
    dto: ProcessPayrollDto,
  ): Promise<PresentedPayroll> {
    const businessId = requireBusinessId(admin, dto.businessId);

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.processWithin(tx, businessId, dto, admin.sub),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new ConflictException(ALREADY_PAID);
        }

        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < MAX_RETRIES
        ) {
          continue;
        }

        throw error;
      }
    }
    throw new ConflictException(
      'Payroll could not be processed due to a concurrent conflict. Please retry.',
    );
  }

  private async settleStaffPayroll(
    tx: Prisma.TransactionClient,
    businessId: string,
    staff: {
      id: string;
      fullName: string;
      locationId: string | null;
      monthlySalary: number | null;
    },
    month: number,
    year: number,
    adminId?: string,
  ): Promise<PresentedPayroll> {
    const existing = await tx.payrollRecord.findFirst({
      where: {
        businessId,
        cashierId: staff.id,
        month,
        year,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(ALREADY_PAID);
    }

    const { end } = payrollPeriod(year, month);

    // Fetch active, non-voided advances taken before payroll-period end in deterministic FIFO order
    const eligibleAdvances = await tx.employeeAdvance.findMany({
      where: {
        businessId,
        cashierId: staff.id,
        deletedAt: null,
        takenAt: { lt: end },
        status: AdvanceStatus.PENDING,
      },
      orderBy: [{ takenAt: 'asc' }, { id: 'asc' }],
    });

    const baseSalary = staff.monthlySalary ?? 0;
    if (baseSalary <= 0) {
      throw new BadRequestException(
        'Cannot process payroll for staff with zero or missing base salary',
      );
    }
    let remainingSalaryToDeduct = baseSalary;
    let totalAdvancesDeducted = 0;
    const deductionsToCreate: Array<{ advanceId: string; amount: number }> = [];
    const advanceUpdates: Array<{
      id: string;
      deductedAmount: number;
      status: AdvanceStatus;
    }> = [];

    for (const advance of eligibleAdvances) {
      const currentDeducted = (advance as any).deductedAmount ?? 0;
      const outstanding = Math.max(0, advance.amount - currentDeducted);
      if (outstanding <= 0) continue;

      if (remainingSalaryToDeduct <= 0) {
        break; // Advance exceeds base salary: remains outstanding and carried forward
      }

      const toDeduct = Math.min(outstanding, remainingSalaryToDeduct);
      remainingSalaryToDeduct -= toDeduct;
      totalAdvancesDeducted += toDeduct;

      const newDeductedAmount = currentDeducted + toDeduct;
      const newStatus =
        newDeductedAmount >= advance.amount
          ? AdvanceStatus.DEDUCTED
          : AdvanceStatus.PENDING;

      deductionsToCreate.push({ advanceId: advance.id, amount: toDeduct });
      advanceUpdates.push({
        id: advance.id,
        deductedAmount: newDeductedAmount,
        status: newStatus,
      });
    }

    const netPaid = Math.max(0, baseSalary - totalAdvancesDeducted);

    const record = await tx.payrollRecord.create({
      data: {
        businessId,
        cashierId: staff.id,
        month,
        year,
        baseSalary,
        totalAdvancesDeducted,
        netPaid,
        status: PayrollStatus.PAID,
        advanceDeductions: {
          create: deductionsToCreate,
        },
      },
      select: payrollSelect,
    });

    // Atomically persist updated advance deductions
    for (const update of advanceUpdates) {
      if ((tx.employeeAdvance as any)?.update) {
        await (tx.employeeAdvance as any).update({
          where: { id: update.id },
          data: {
            deductedAmount: update.deductedAmount,
            status: update.status,
          },
        });
      } else if (tx.employeeAdvance?.updateMany) {
        await tx.employeeAdvance.updateMany({
          where: { id: update.id },
          data: {
            deductedAmount: update.deductedAmount,
            status: update.status,
          } as any,
        });
      }
    }

    // Only create PAYROLL_NET Expense if netPaid > 0.
    // If netPaid == 0, do not create a fictitious zero Expense.
    if (netPaid > 0 && tx.expense?.create) {
      await tx.expense.create({
        data: {
          businessId,
          locationId: staff.locationId ?? null,
          userId: adminId ?? staff.id,
          beneficiaryCashierId: staff.id,
          amount: netPaid,
          title: `Payroll Disbursement - ${staff.fullName} (${month}/${year})`,
          category: ExpenseCategory.SALARIES,
          sourceType: ExpenseSourceType.PAYROLL_NET,
          note: `Monthly salary payout (Base: ${baseSalary} BDT, Advances Deducted: ${totalAdvancesDeducted} BDT, Net Paid: ${netPaid} BDT).`,
          spentAt: record.createdAt,
          paidAt: record.createdAt,
          payrollId: record.id,
        },
      });
    }

    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          actorId: adminId ?? staff.id,
          businessId,
          locationId: staff.locationId ?? null,
          action: 'PAYROLL_DISBURSED',
          entityType: 'PAYROLL_RECORD',
          entityId: record.id,
          metadata: {
            cashierId: staff.id,
            month,
            year,
            baseSalary,
            totalAdvancesDeducted,
            netPaid,
            appliedAdvanceIds: deductionsToCreate.map((d) => d.advanceId),
          },
        },
      });
    }

    return record;
  }

  async processWithin(
    tx: Prisma.TransactionClient,
    businessId: string,
    dto: ProcessPayrollDto,
    adminId?: string,
  ): Promise<PresentedPayroll> {
    const cashier = await tx.user.findFirst({
      where: {
        id: dto.cashierId,
        businessId,
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

    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }

    if (!cashier.monthlySalary || cashier.monthlySalary <= 0) {
      throw new BadRequestException(
        'Cashier does not have a positive base salary configured for payroll',
      );
    }

    return this.settleStaffPayroll(
      tx,
      businessId,
      cashier,
      dto.month,
      dto.year,
      adminId,
    );
  }

  async summary(admin: AccessTokenPayload, query: PayrollHistoryQueryDto) {
    const businessId = requireBusinessId(admin, query.businessId);
    const now = new Date();
    const currentPeriod = getDhakaDateParts(now);
    const month = query.month ?? currentPeriod.month;
    const year = query.year ?? currentPeriod.year;
    const { end } = payrollPeriod(year, month);

    const [staffList, existingRecords, pendingAdvances] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          businessId,
          role: Role.CASHIER,
          deletedAt: null,
          monthlySalary: { not: null },
          ...(query.locationId ? { locationId: query.locationId } : {}),
        },
        select: {
          id: true,
          publicId: true,
          fullName: true,
          role: true,
          monthlySalary: true,
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.payrollRecord.findMany({
        where: {
          businessId,
          month,
          year,
          ...(query.locationId
            ? { cashier: { locationId: query.locationId } }
            : {}),
        },
        select: payrollSelect,
      }),
      this.prisma.employeeAdvance.findMany({
        where: {
          businessId,
          deletedAt: null,
          takenAt: { lt: end },
          status: AdvanceStatus.PENDING,
          ...(query.locationId
            ? {
                OR: [
                  { locationId: query.locationId },
                  {
                    locationId: null,
                    cashier: { locationId: query.locationId },
                  },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          cashierId: true,
          amount: true,
          deductedAmount: true,
          takenAt: true,
        },
        orderBy: [{ takenAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const recordsByCashier = new Map(
      existingRecords.map((r) => [r.cashierId, r]),
    );

    const pendingAdvancesByCashier = new Map<string, typeof pendingAdvances>();
    for (const adv of pendingAdvances) {
      const list = pendingAdvancesByCashier.get(adv.cashierId) ?? [];
      list.push(adv);
      pendingAdvancesByCashier.set(adv.cashierId, list);
    }

    let totalPayroll = 0;
    const activeEmployees = staffList.map((emp) => {
      const record = recordsByCashier.get(emp.id);
      const isPaid = !!record;
      const baseSalary = record?.baseSalary ?? emp.monthlySalary ?? 0;

      let advancesDeducted = 0;
      let netPay = baseSalary;

      if (isPaid) {
        advancesDeducted = record.totalAdvancesDeducted;
        netPay = record.netPaid;
      } else {
        const advList = pendingAdvancesByCashier.get(emp.id) ?? [];
        const eligibleOutstanding = advList.reduce((sum, adv) => {
          return (
            sum +
            Math.max(0, adv.amount - ((adv as any).deductedAmount ?? 0))
          );
        }, 0);
        advancesDeducted = Math.min(baseSalary, eligibleOutstanding);
        netPay = Math.max(0, baseSalary - advancesDeducted);
      }

      totalPayroll += netPay;

      return {
        id: emp.id,
        employeeName: emp.fullName,
        employeeCode: emp.publicId ?? `EMP-${emp.id.slice(-4)}`,
        role: emp.role,
        baseSalary,
        allowances: 0,
        overtime: 0,
        advancesDeducted,
        netPay,
        status: isPaid ? 'PAID' : 'DUE',
        paidAt: record?.createdAt ?? null,
      };
    });

    const activeStaffIds = new Set(staffList.map((s) => s.id));
    const extraPaidRecords = existingRecords.filter(
      (r) => !activeStaffIds.has(r.cashierId),
    );

    const extraEmployees = extraPaidRecords.map((record) => {
      totalPayroll += record.netPaid;
      return {
        id: record.cashierId,
        employeeName: record.cashier?.fullName ?? 'Former Staff',
        employeeCode:
          record.cashier?.publicId ?? `EMP-${record.cashierId.slice(-4)}`,
        role: Role.CASHIER,
        baseSalary: record.baseSalary,
        allowances: 0,
        overtime: 0,
        advancesDeducted: record.totalAdvancesDeducted,
        netPay: record.netPaid,
        status: 'PAID' as const,
        paidAt: record.createdAt ?? null,
      };
    });

    const employees = [...activeEmployees, ...extraEmployees];

    const paidCount = employees.filter((e) => e.status === 'PAID').length;
    let disbursementStatus: 'DISBURSED' | 'PARTIAL' | 'PENDING' = 'PENDING';
    if (employees.length > 0) {
      if (paidCount === employees.length) {
        disbursementStatus = 'DISBURSED';
      } else if (paidCount > 0) {
        disbursementStatus = 'PARTIAL';
      }
    }

    const outstandingPayroll = employees
      .filter((e) => e.status !== 'PAID')
      .reduce((sum, e) => sum + e.netPay, 0);
    const totalPaidPayroll = employees
      .filter((e) => e.status === 'PAID')
      .reduce((sum, e) => sum + e.netPay, 0);

    return {
      totalMonthlyPayroll: totalPayroll,
      outstandingPayroll,
      totalPaidPayroll,
      disbursementStatus,
      totalAllowancesAndOvertime: 0,
      totalStaff: employees.length,
      month,
      year,
      employees,
    };
  }

  async disburse(admin: AccessTokenPayload, dto: DisbursePayrollDto) {
    const businessId = requireBusinessId(admin, dto.businessId);

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const staffList = await tx.user.findMany({
              where: {
                businessId,
                role: Role.CASHIER,
                deletedAt: null,
                monthlySalary: { not: null, gt: 0 },
                ...(dto.locationId ? { locationId: dto.locationId } : {}),
              },
              select: {
                id: true,
                fullName: true,
                locationId: true,
                monthlySalary: true,
              },
            });

            const existingRecords = await tx.payrollRecord.findMany({
              where: {
                businessId,
                month: dto.month,
                year: dto.year,
                ...(dto.locationId
                  ? { cashier: { locationId: dto.locationId } }
                  : {}),
              },
              select: { cashierId: true },
            });

            const paidSet = new Set(existingRecords.map((r) => r.cashierId));
            const pendingStaff = staffList.filter((s) => !paidSet.has(s.id));

            const createdRecords: PresentedPayroll[] = [];

            for (const staff of pendingStaff) {
              const record = await this.settleStaffPayroll(
                tx,
                businessId,
                staff,
                dto.month,
                dto.year,
                admin.sub,
              );
              createdRecords.push(record);
            }

            return {
              success: true,
              disbursedCount: createdRecords.length,
              alreadyPaidCount: existingRecords.length,
              totalAmount: createdRecords.reduce(
                (sum, r) => sum + r.netPaid,
                0,
              ),
              month: dto.month,
              year: dto.year,
              records: createdRecords,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < MAX_RETRIES
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException(
      'Batch payroll disbursement could not be completed due to a concurrent conflict. Please retry.',
    );
  }

  list(
    admin: AccessTokenPayload,
    query: PayrollHistoryQueryDto,
  ): Promise<PresentedPayroll[]> {
    const businessId = requireBusinessId(admin, query.businessId);
    const now = new Date();
    const currentPeriod = getDhakaDateParts(now);
    const month = query.month ?? currentPeriod.month;
    const year = query.year ?? currentPeriod.year;

    return this.prisma.payrollRecord.findMany({
      where: {
        businessId,
        month,
        year,
        ...(query.locationId
          ? { cashier: { locationId: query.locationId } }
          : {}),
      },
      select: payrollSelect,
      orderBy: { createdAt: 'asc' },
    });
  }
}
