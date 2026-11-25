import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdvanceStatus,
  ExpenseCategory,
  ExpenseSourceType,
  OrderStatus,
  PaymentMethod,
  Prisma,
  Role,
  ShiftStatus,
} from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { getDhakaDateParts } from '../common/utils/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { AdvanceSummaryQueryDto } from './dto/advance-summary.query';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { ListAdvancesQueryDto } from './dto/list-advances.query';
import { payrollPeriod } from './payroll-period';
import { getDhakaDayRange } from '../common/utils/timezone.util';
import { requireBusinessId } from './require-business-id';

const advanceSelect = {
  id: true,
  cashierId: true,
  shiftId: true,
  amount: true,
  deductedAmount: true,
  reason: true,
  status: true,
  takenAt: true,
  createdAt: true,
} satisfies Prisma.EmployeeAdvanceSelect;

export type PresentedAdvance = Prisma.EmployeeAdvanceGetPayload<{
  select: typeof advanceSelect;
}> & {
  remainingAmount?: number;
};

export interface AdvanceSummary {
  history: PresentedAdvance[];
  summary: {
    baseSalary: number;
    totalPendingAdvances: number;
    advancesDeducted?: number;
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

    const executeInTx = async (tx: any) => {
      // Shift is optional per MVP policy; if active shift exists, link it
      let shiftId: string | undefined = undefined;
      let shiftLocationId: string | null = cashier.locationId ?? null;

      if (tx.shiftSession?.findFirst) {
        const { start: startOfToday, nextStart: nextDayStart } =
          getDhakaDayRange();
        const activeShift = await tx.shiftSession.findFirst({
          where: {
            cashierId: actor.sub,
            businessId,
            ...(cashier.locationId ? { locationId: cashier.locationId } : {}),
            status: ShiftStatus.OPEN,
            openedAt: { gte: startOfToday, lt: nextDayStart },
          },
          select: { id: true, locationId: true },
        });

        if (activeShift) {
          shiftId = activeShift.id;
          shiftLocationId = activeShift.locationId;
        }
      }

      // MVP POLICY: Advances belong strictly to the EmployeeAdvance ledger.
      // They do not require an open shift, positive drawer funds, or monthly salary caps.
      // They do NOT create an Expense and do NOT deduct from payroll.
      const advance = await tx.employeeAdvance.create({
        data: {
          businessId,
          cashierId,
          locationId: shiftLocationId,
          amount: dto.amount,
          reason: dto.reason?.trim() || null,
          status: AdvanceStatus.PENDING,
          ...(shiftId ? { shiftId } : {}),
        },
        select: advanceSelect,
      });

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            businessId,
            locationId: shiftLocationId,
            action: 'SALARY_ADVANCE_TAKEN',
            entityType: 'EMPLOYEE_ADVANCE',
            entityId: advance.id,
            metadata: {
              amount: dto.amount,
              cashierId: cashier.id,
              shiftId,
              reason: dto.reason?.trim() || null,
            },
          },
        });
      }

      return advance;
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

    const executeRemove = async (tx: any) => {
      let existing: any = null;
      if (tx.employeeAdvance?.findFirst) {
        existing = await tx.employeeAdvance.findFirst({
          where: { id: advanceId, businessId, deletedAt: null },
        });

        if (!existing) {
          throw new NotFoundException('Advance not found');
        }

        if (
          existing.status === AdvanceStatus.DEDUCTED ||
          (existing.deductedAmount ?? 0) > 0
        ) {
          throw new ConflictException(
            'Cannot delete an advance that has already been partially or fully deducted in payroll',
          );
        }

        if (existing.shiftId && tx.shiftSession?.findFirst) {
          const shift = await tx.shiftSession.findFirst({
            where: { id: existing.shiftId },
            select: { id: true, status: true },
          });
          if (shift && shift.status === ShiftStatus.CLOSED) {
            throw new BadRequestException(
              'Cannot void a cash advance from a closed shift; the register is already reconciled and closed',
            );
          }
        }
      }

      const removed = await tx.employeeAdvance.updateMany({
        where: {
          id: advanceId,
          businessId,
          status: AdvanceStatus.PENDING,
          deductedAmount: 0,
          deletedAt: null,
        },
        data: { deletedAt },
      });

      if (removed.count === 0) {
        throw new NotFoundException('Advance not found');
      }

      if (tx.expense?.updateMany) {
        await tx.expense.updateMany({
          where: {
            advanceId,
            businessId,
            deletedAt: null,
          },
          data: { deletedAt },
        });
      }

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            businessId,
            locationId: existing?.locationId ?? null,
            action: 'SALARY_ADVANCE_VOIDED',
            entityType: 'EMPLOYEE_ADVANCE',
            entityId: advanceId,
            metadata: {
              amount: existing?.amount,
              cashierId: existing?.cashierId,
              shiftId: existing?.shiftId,
            },
          },
        });
      }

      return { id: advanceId, deletedAt };
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction(executeRemove);
    }
    return executeRemove(this.prisma);
  }

  async list(actor: AccessTokenPayload, query: ListAdvancesQueryDto) {
    const businessId = requireBusinessId(actor, query.businessId);
    const where: Prisma.EmployeeAdvanceWhereInput = {
      businessId,
    };

    if (query.status === 'VOIDED') {
      where.deletedAt = { not: null };
    } else if (query.status === AdvanceStatus.PENDING) {
      where.status = AdvanceStatus.PENDING;
      where.deletedAt = null;
    } else if (query.status === AdvanceStatus.DEDUCTED) {
      where.status = AdvanceStatus.DEDUCTED;
      where.deletedAt = null;
    } else if (!query.includeDeleted) {
      where.deletedAt = null;
    }

    if (actor.role === Role.CASHIER) {
      where.cashierId = actor.sub;
    } else {
      if (query.cashierId) {
        where.cashierId = query.cashierId;
      }
      if (query.locationId) {
        where.OR = [
          { locationId: query.locationId },
          { locationId: null, cashier: { locationId: query.locationId } },
        ];
      }
    }

    if (query.month || query.year) {
      const now = new Date();
      const currentPeriod = getDhakaDateParts(now);
      const month = query.month ?? currentPeriod.month;
      const year = query.year ?? currentPeriod.year;
      const { start, end } = payrollPeriod(year, month);
      where.takenAt = { gte: start, lt: end };
    }

    const advances = await (this.prisma.employeeAdvance.findMany as any)({
      where,
      select: {
        id: true,
        cashierId: true,
        locationId: true,
        amount: true,
        deductedAmount: true,
        reason: true,
        status: true,
        deletedAt: true,
        takenAt: true,
        createdAt: true,
        location: {
          select: {
            name: true,
          },
        },
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

    const items = advances.map((adv: any) => ({
      id: adv.id,
      cashierId: adv.cashierId,
      employeeName: adv.cashier?.fullName ?? 'Unknown',
      employeeCode: adv.cashier?.publicId ?? `CSH-${adv.cashierId.slice(-4)}`,
      role: adv.cashier?.role ?? Role.CASHIER,
      locationName:
        adv.location?.name ?? adv.cashier?.location?.name ?? 'Unassigned',
      amount: adv.amount,
      deductedAmount: adv.deductedAmount ?? 0,
      remainingAmount: Math.max(0, adv.amount - (adv.deductedAmount ?? 0)),
      reason: adv.reason,
      status: adv.deletedAt ? 'VOIDED' : adv.status,
      deletedAt: adv.deletedAt ?? null,
      takenAt: adv.takenAt,
      createdAt: adv.createdAt,
    }));

    const totalActiveAdvances = advances
      .filter((a: any) => !a.deletedAt && a.status === AdvanceStatus.PENDING)
      .reduce((sum: number, a: any) => sum + (Math.max(0, a.amount - (a.deductedAmount ?? 0))), 0);

    const pendingCount = advances.filter(
      (a: any) => !a.deletedAt && a.status === AdvanceStatus.PENDING,
    ).length;

    const deductedCount = advances.filter(
      (a: any) => !a.deletedAt && a.status === AdvanceStatus.DEDUCTED,
    ).length;

    const voidedCount = advances.filter((a: any) => Boolean(a.deletedAt)).length;

    return {
      items,
      summary: {
        totalActiveAdvances,
        pendingCount,
        deductedCount,
        voidedCount,
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

    const presentedHistory: PresentedAdvance[] = history.map((adv) => ({
      ...adv,
      remainingAmount: Math.max(0, adv.amount - (adv.deductedAmount ?? 0)),
    }));

    const totalPendingAdvances = presentedHistory.reduce(
      (total, advance) => total + (advance.remainingAmount ?? advance.amount),
      0,
    );

    if (cashier && targetCashierId) {
      const existingPayroll = this.prisma.payrollRecord?.findFirst
        ? await this.prisma.payrollRecord.findFirst({
            where: {
              businessId,
              cashierId: targetCashierId,
              month: query.month,
              year: query.year,
            },
          })
        : null;

      if (existingPayroll) {
        return {
          history: presentedHistory,
          summary: {
            baseSalary: existingPayroll.baseSalary,
            totalPendingAdvances,
            advancesDeducted: existingPayroll.totalAdvancesDeducted,
            netPayable: existingPayroll.netPaid,
          },
        };
      }

      // Unpaid employee: estimate eligible outstanding deduction
      const eligibleAdvances = this.prisma.employeeAdvance?.findMany
        ? await this.prisma.employeeAdvance.findMany({
            where: {
              businessId,
              cashierId: targetCashierId,
              deletedAt: null,
              status: AdvanceStatus.PENDING,
              takenAt: { lt: end },
            },
          })
        : [];
      const eligibleOutstanding = eligibleAdvances.reduce(
        (sum, a) => sum + Math.max(0, a.amount - (a.deductedAmount ?? 0)),
        0,
      );

      const baseSalary = cashier.monthlySalary ?? 0;
      const advancesDeducted = Math.min(baseSalary, eligibleOutstanding);
      const netPayable = Math.max(0, baseSalary - advancesDeducted);

      return {
        history: presentedHistory,
        summary: {
          baseSalary,
          totalPendingAdvances,
          advancesDeducted,
          netPayable,
        },
      };
    }

    return {
      history: presentedHistory,
      summary: {
        baseSalary: 0,
        totalPendingAdvances,
        advancesDeducted: 0,
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

    return cashier;
  }
}
