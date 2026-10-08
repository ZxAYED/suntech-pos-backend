import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdvanceStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { PrismaService } from '../prisma/prisma.service';
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
}>;

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

  list(
    admin: AccessTokenPayload,
    query: PayrollHistoryQueryDto,
  ): Promise<PresentedPayroll[]> {
    const businessId = requireBusinessId(admin);

    return this.prisma.payrollRecord.findMany({
      where: {
        businessId,
        month: query.month,
        year: query.year,
      },
      select: payrollSelect,
      orderBy: { createdAt: 'asc' },
    });
  }
}
