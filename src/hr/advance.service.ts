import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdvanceStatus, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { PrismaService } from '../prisma/prisma.service';
import { AdvanceSummaryQueryDto } from './dto/advance-summary.query';
import { CreateAdvanceDto } from './dto/create-advance.dto';
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
    const businessId = requireBusinessId(actor);
    const cashierId = await this.resolveCashierId(
      actor,
      businessId,
      dto.cashierId,
    );

    return this.prisma.employeeAdvance.create({
      data: {
        businessId,
        cashierId,
        amount: dto.amount,
        reason: dto.reason?.trim() || null,
        status: AdvanceStatus.PENDING,
      },
      select: advanceSelect,
    });
  }

  async remove(
    actor: AccessTokenPayload,
    advanceId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(actor);
    const deletedAt = new Date();
    const removed = await this.prisma.employeeAdvance.updateMany({
      where: {
        id: advanceId,
        businessId,
        deletedAt: null,
      },
      data: { deletedAt },
    });

    if (removed.count === 0) {
      throw new NotFoundException('Advance not found');
    }

    return { id: advanceId, deletedAt };
  }

  async summary(
    actor: AccessTokenPayload,
    query: AdvanceSummaryQueryDto,
  ): Promise<AdvanceSummary> {
    const businessId = requireBusinessId(actor);
    const cashierId = this.resolveSummaryCashierId(actor, query.cashierId);
    const cashier = await this.findCashier(businessId, cashierId);
    const { start, end } = payrollPeriod(query.year, query.month);
    const history = await this.prisma.employeeAdvance.findMany({
      where: {
        businessId,
        cashierId,
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

  private resolveSummaryCashierId(
    actor: AccessTokenPayload,
    requestedCashierId?: string,
  ): string {
    if (actor.role === Role.CASHIER) {
      if (requestedCashierId && requestedCashierId !== actor.sub) {
        throw new ForbiddenException('You can only view your own advances');
      }

      return actor.sub;
    }

    if (!requestedCashierId) {
      throw new BadRequestException('cashierId is required');
    }

    return requestedCashierId;
  }

  private async resolveCashierId(
    actor: AccessTokenPayload,
    businessId: string,
    requestedCashierId?: string,
  ): Promise<string> {
    if (actor.role === Role.CASHIER) {
      await this.findCashier(businessId, actor.sub);
      return actor.sub;
    }

    if (!requestedCashierId) {
      throw new BadRequestException('cashierId is required');
    }

    await this.findCashier(businessId, requestedCashierId);
    return requestedCashierId;
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
