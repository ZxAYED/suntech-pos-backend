import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdvanceStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
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
    const businessId = requireBusinessId(admin);

    try {
      return await this.prisma.$transaction((tx) =>
        this.processWithin(tx, businessId, dto),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(ALREADY_PAID);
      }

      throw error;
    }
  }

  async processWithin(
    tx: Prisma.TransactionClient,
    businessId: string,
    dto: ProcessPayrollDto,
  ): Promise<PresentedPayroll> {
    const cashier = await tx.user.findFirst({
      where: {
        id: dto.cashierId,
        businessId,
        role: Role.CASHIER,
        deletedAt: null,
      },
      select: { id: true, monthlySalary: true },
    });

    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }

    const existing = await tx.payrollRecord.findFirst({
      where: {
        businessId,
        cashierId: cashier.id,
        month: dto.month,
        year: dto.year,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(ALREADY_PAID);
    }

    const { start, end } = payrollPeriod(dto.year, dto.month);
    const advanceWhere = {
      businessId,
      cashierId: cashier.id,
      status: AdvanceStatus.PENDING,
      deletedAt: null,
      takenAt: { gte: start, lt: end },
    };
    const aggregate = await tx.employeeAdvance.aggregate({
      where: advanceWhere,
      _sum: { amount: true },
    });
    const totalAdvancesDeducted = aggregate._sum.amount ?? 0;
    const baseSalary = cashier.monthlySalary ?? 0;

    if (totalAdvancesDeducted > baseSalary) {
      throw new BadRequestException('Total advances cannot exceed base salary');
    }

    await tx.employeeAdvance.updateMany({
      where: advanceWhere,
      data: { status: AdvanceStatus.DEDUCTED },
    });

    return tx.payrollRecord.create({
      data: {
        businessId,
        cashierId: cashier.id,
        month: dto.month,
        year: dto.year,
        baseSalary,
        totalAdvancesDeducted,
        netPaid: baseSalary - totalAdvancesDeducted,
        status: PayrollStatus.PAID,
      },
      select: payrollSelect,
    });
  }

  async summary(admin: AccessTokenPayload, query: PayrollHistoryQueryDto) {
    const businessId = requireBusinessId(admin);
    const now = new Date();
    const month = query.month ?? now.getMonth() + 1;
    const year = query.year ?? now.getFullYear();

    const [staffList, existingRecords] = await Promise.all([
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
    ]);

    const { start, end } = payrollPeriod(year, month);
    const pendingAdvances = await this.prisma.employeeAdvance.findMany({
      where: {
        businessId,
        status: AdvanceStatus.PENDING,
        deletedAt: null,
        takenAt: { gte: start, lt: end },
        ...(query.locationId
          ? { cashier: { locationId: query.locationId } }
          : {}),
      },
      select: { cashierId: true, amount: true },
    });

    const advancesByCashier = new Map<string, number>();
    for (const adv of pendingAdvances) {
      advancesByCashier.set(
        adv.cashierId,
        (advancesByCashier.get(adv.cashierId) ?? 0) + adv.amount,
      );
    }

    const recordsByCashier = new Map(
      existingRecords.map((r) => [r.cashierId, r]),
    );

    let totalPayroll = 0;
    const employees = staffList.map((emp) => {
      const record = recordsByCashier.get(emp.id);
      const isPaid = !!record;
      const baseSalary = record?.baseSalary ?? emp.monthlySalary ?? 0;
      const advancesDeducted = record
        ? record.totalAdvancesDeducted
        : (advancesByCashier.get(emp.id) ?? 0);
      const netPay = record
        ? record.netPaid
        : Math.max(0, baseSalary - advancesDeducted);

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

    const paidCount = employees.filter((e) => e.status === 'PAID').length;
    let disbursementStatus: 'DISBURSED' | 'PARTIAL' | 'PENDING' = 'PENDING';
    if (employees.length > 0) {
      if (paidCount === employees.length) {
        disbursementStatus = 'DISBURSED';
      } else if (paidCount > 0) {
        disbursementStatus = 'PARTIAL';
      }
    }

    return {
      totalMonthlyPayroll: totalPayroll,
      disbursementStatus,
      totalAllowancesAndOvertime: 0,
      totalStaff: employees.length,
      month,
      year,
      employees,
    };
  }

  async disburse(admin: AccessTokenPayload, dto: DisbursePayrollDto) {
    const businessId = requireBusinessId(admin);

    return this.prisma.$transaction(async (tx) => {
      const staffList = await tx.user.findMany({
        where: {
          businessId,
          role: Role.CASHIER,
          deletedAt: null,
          monthlySalary: { not: null, gt: 0 },
          ...(dto.locationId ? { locationId: dto.locationId } : {}),
        },
        select: { id: true, monthlySalary: true },
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

      const { start, end } = payrollPeriod(dto.year, dto.month);
      const createdRecords = [];

      for (const staff of pendingStaff) {
        const advanceWhere = {
          businessId,
          cashierId: staff.id,
          status: AdvanceStatus.PENDING,
          deletedAt: null,
          takenAt: { gte: start, lt: end },
        };

        const aggregate = await tx.employeeAdvance.aggregate({
          where: advanceWhere,
          _sum: { amount: true },
        });
        const totalAdvancesDeducted = aggregate._sum.amount ?? 0;
        const baseSalary = staff.monthlySalary ?? 0;

        if (totalAdvancesDeducted > baseSalary) {
          throw new BadRequestException(
            `Total advances (${totalAdvancesDeducted}) cannot exceed base salary (${baseSalary})`,
          );
        }

        const netPaid = baseSalary - totalAdvancesDeducted;

        await tx.employeeAdvance.updateMany({
          where: advanceWhere,
          data: { status: AdvanceStatus.DEDUCTED },
        });

        const record = await tx.payrollRecord.create({
          data: {
            businessId,
            cashierId: staff.id,
            month: dto.month,
            year: dto.year,
            baseSalary,
            totalAdvancesDeducted,
            netPaid,
            status: PayrollStatus.PAID,
          },
          select: payrollSelect,
        });

        createdRecords.push(record);
      }

      return {
        success: true,
        disbursedCount: createdRecords.length,
        alreadyPaidCount: existingRecords.length,
        month: dto.month,
        year: dto.year,
        records: createdRecords,
      };
    });
  }

  list(
    admin: AccessTokenPayload,
    query: PayrollHistoryQueryDto,
  ): Promise<PresentedPayroll[]> {
    const businessId = requireBusinessId(admin);
    const now = new Date();
    const month = query.month ?? now.getMonth() + 1;
    const year = query.year ?? now.getFullYear();

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
