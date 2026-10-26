import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdvanceStatus, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { getDhakaDateParts } from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AdvanceSummaryQueryDto } from './dto/advance-summary.query';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { ListAdvancesQueryDto } from './dto/list-advances.query';
import { payrollPeriod } from './payroll-period';
import { requireBusinessId } from './require-business-id';

const advanceSelect = {
  id: true,
  cashierId: true,
  amount: true,
  reason: true,
  status: true,
  takenAt: true,
  createdAt: true,
} satisfies Prisma.EmployeeAdvanceSelect;

export type PresentedAdvance = Prisma.EmployeeAdvanceGetPayload<{
  select: typeof advanceSelect;
}>;

export interface AdvanceSummary {
  history: PresentedAdvance[];
  summary: {
    baseSalary: number;
    totalPendingAdvances: number;
    netPayable: number;
  };
}

@Injectable()
export class AdvanceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actor: AccessTokenPayload,
    dto: CreateAdvanceDto,
  ): Promise<PresentedAdvance> {
    if (actor.role !== Role.CASHIER) {
      throw new ForbiddenException(
        'Only cashiers can create employee advance ledger requests',
      );
    }
    const businessId = requireBusinessId(actor);
    const cashierId = actor.sub;
    const cashier = await this.findCashier(businessId, cashierId);

    const now = new Date();
    const currentPeriod = getDhakaDateParts(now);
    const { start, end } = payrollPeriod(
      currentPeriod.year,
      currentPeriod.month,
    );

    const executeInTx = async (tx: any) => {
      const maxSalary = cashier.monthlySalary ?? 0;
      if (maxSalary <= 0) {
        throw new BadRequestException(
          'Salary advances require a positive monthly salary configured on your account',
        );
      }

      if (tx.payrollRecord?.findFirst) {
        const settled = await tx.payrollRecord.findFirst({
          where: {
            businessId,
            cashierId,
            month: currentPeriod.month,
            year: currentPeriod.year,
            status: 'PAID',
          },
        });
        if (settled) {
          throw new BadRequestException(
            'Payroll for this month has already been settled',
          );
        }
      }

      let currentPending = 0;
      if (tx.employeeAdvance?.aggregate) {
        const agg = await tx.employeeAdvance.aggregate({
          where: {
            businessId,
            cashierId,
            status: AdvanceStatus.PENDING,
            deletedAt: null,
            takenAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        });
        currentPending = agg._sum?.amount ?? 0;
      } else if (tx.employeeAdvance?.findMany) {
        const existing = await tx.employeeAdvance.findMany({
          where: {
            businessId,
            cashierId,
            status: AdvanceStatus.PENDING,
            deletedAt: null,
            takenAt: { gte: start, lt: end },
          },
        });
        currentPending = Array.isArray(existing)
          ? existing.reduce(
              (sum: number, item: any) => sum + (item.amount ?? 0),
              0,
            )
          : 0;
      }

      if (currentPending + dto.amount > maxSalary) {
        const remaining = Math.max(0, maxSalary - currentPending);
        throw new BadRequestException(
          `Advance amount (${dto.amount}) exceeds remaining monthly salary limit (${remaining})`,
        );
      }

      let shiftId: string | undefined = undefined;
      if (actor.role === Role.CASHIER && tx.shiftSession?.findFirst) {
        const activeShift = await tx.shiftSession.findFirst({
          where: {
            cashierId: actor.sub,
            businessId,
            status: 'OPEN',
          },
        });
        if (activeShift) {
          shiftId = activeShift.id;
        }
      }

      return tx.employeeAdvance.create({
        data: {
          businessId,
          cashierId,
          amount: dto.amount,
          reason: dto.reason?.trim() || null,
          status: AdvanceStatus.PENDING,
          ...(shiftId ? { shiftId } : {}),
        },
        select: advanceSelect,
      });
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction((tx) => executeInTx(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return executeInTx(this.prisma);
  }

  async remove(
    actor: AccessTokenPayload,
    advanceId: string,
    requestedBusinessId?: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(actor, requestedBusinessId);
    const deletedAt = new Date();

    if (this.prisma.employeeAdvance?.findFirst) {
      const existing = await this.prisma.employeeAdvance.findFirst({
        where: { id: advanceId, businessId, deletedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Advance not found');
      }

      if (existing.status === AdvanceStatus.DEDUCTED) {
        throw new BadRequestException(
          'Cannot delete an advance that has already been deducted in payroll',
        );
      }
    }

    const removed = await this.prisma.employeeAdvance.updateMany({
      where: {
        id: advanceId,
        businessId,
        status: AdvanceStatus.PENDING,
        deletedAt: null,
      },
      data: { deletedAt },
    });

    if (removed.count === 0) {
      throw new NotFoundException('Advance not found');
    }

    return { id: advanceId, deletedAt };
  }

  async list(actor: AccessTokenPayload, query: ListAdvancesQueryDto) {
    const businessId = requireBusinessId(actor, query.businessId);
    const where: Prisma.EmployeeAdvanceWhereInput = {
      businessId,
      deletedAt: null,
    };

    if (actor.role === Role.CASHIER) {
      where.cashierId = actor.sub;
      if (actor.locationId) {
        where.cashier = { locationId: actor.locationId };
      }
    } else {
      if (query.cashierId) {
        where.cashierId = query.cashierId;
      }
      if (query.locationId) {
        where.cashier = {
          ...(where.cashier as Prisma.UserWhereInput),
          locationId: query.locationId,
        };
      }
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.month || query.year) {
      const now = new Date();
      const currentPeriod = getDhakaDateParts(now);
      const month = query.month ?? currentPeriod.month;
      const year = query.year ?? currentPeriod.year;
      const { start, end } = payrollPeriod(year, month);
      where.takenAt = { gte: start, lt: end };
    }

    const advances = await this.prisma.employeeAdvance.findMany({
      where,
      select: {
        id: true,
        cashierId: true,
        amount: true,
        reason: true,
        status: true,
        takenAt: true,
        createdAt: true,
        cashier: {
          select: {
            fullName: true,
            publicId: true,
            role: true,
            location: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { takenAt: 'desc' },
    });

    const items = advances.map((adv) => ({
      id: adv.id,
      cashierId: adv.cashierId,
      employeeName: adv.cashier.fullName,
      employeeCode: adv.cashier.publicId ?? `CSH-${adv.cashierId.slice(-4)}`,
      role: adv.cashier.role,
      locationName: adv.cashier.location?.name ?? 'Unassigned',
      amount: adv.amount,
      reason: adv.reason,
      status: adv.status,
      takenAt: adv.takenAt,
      createdAt: adv.createdAt,
    }));

    const totalActiveAdvances = advances
      .filter((a) => a.status === AdvanceStatus.PENDING)
      .reduce((sum, a) => sum + a.amount, 0);

    const pendingCount = advances.filter(
      (a) => a.status === AdvanceStatus.PENDING,
    ).length;

    const deductedCount = advances.filter(
      (a) => a.status === AdvanceStatus.DEDUCTED,
    ).length;

    return {
      items,
      summary: {
        totalActiveAdvances,
        pendingCount,
        deductedCount,
      },
    };
  }

  async summary(
    actor: AccessTokenPayload,
    query: AdvanceSummaryQueryDto,
  ): Promise<AdvanceSummary> {
    const businessId = requireBusinessId(actor, query.businessId);
    const { start, end } = payrollPeriod(query.year, query.month);

    let targetCashierId: string | undefined = undefined;
    let cashier: { id: string; monthlySalary: number | null } | null = null;

    if (actor.role === Role.CASHIER) {
      if (query.cashierId && query.cashierId !== actor.sub) {
        throw new ForbiddenException('You can only view your own advances');
      }
      targetCashierId = actor.sub;
      cashier = await this.findCashier(businessId, targetCashierId);
    } else if (query.cashierId?.trim()) {
      targetCashierId = query.cashierId.trim();
      cashier = await this.findCashier(businessId, targetCashierId);
    }

    const history = await this.prisma.employeeAdvance.findMany({
      where: {
        businessId,
        ...(targetCashierId ? { cashierId: targetCashierId } : {}),
        status: AdvanceStatus.PENDING,
        deletedAt: null,
        takenAt: { gte: start, lt: end },
      },
      select: advanceSelect,
      orderBy: { takenAt: 'desc' },
    });

    const totalPendingAdvances = history.reduce(
      (total, advance) => total + advance.amount,
      0,
    );

    if (cashier) {
      const baseSalary = cashier.monthlySalary ?? 0;
      return {
        history,
        summary: {
          baseSalary,
          totalPendingAdvances,
          netPayable: baseSalary - totalPendingAdvances,
        },
      };
    }

    return {
      history,
      summary: {
        baseSalary: 0,
        totalPendingAdvances,
        netPayable: 0,
      },
    };
  }

  private async findCashier(businessId: string, cashierId: string) {
    const cashier = await this.prisma.user.findFirst({
      where: {
        id: cashierId,
        businessId,
        role: Role.CASHIER,
        deletedAt: null,
      },
      select: { id: true, monthlySalary: true },
    });

    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }

    return cashier;
  }
}
