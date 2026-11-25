import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseCategory, ExpenseSourceType, Prisma } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { payrollPeriod } from '../hr/payroll-period';
import {
  getDhakaDateParts,
  parseDhakaDateString,
  parseStrictEventInstant,
} from '../common/utils/timezone.util';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseSummaryQueryDto } from './dto/expense-summary.query';
import { ListExpensesQueryDto } from './dto/list-expenses.query';
import { UpdateExpenseDto } from './dto/update-expense.dto';

const expenseSelect = {
  id: true,
  businessId: true,
  locationId: true,
  userId: true,
  sourceType: true,
  beneficiaryCashierId: true,
  amount: true,
  title: true,
  category: true,
  note: true,
  spentAt: true,
  paidAt: true,
  advanceId: true,
  payrollId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      name: true,
    },
  },
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
    },
  },
  beneficiaryCashier: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
    },
  },
} satisfies Prisma.ExpenseSelect;

export type PresentedExpense = Prisma.ExpenseGetPayload<{
  select: typeof expenseSelect;
}> & {
  type: ExpenseSourceType;
};

export interface CategoryExpenseBreakdown {
  category: ExpenseCategory;
  total: number;
  count: number;
}

export interface TypeExpenseBreakdown {
  type: ExpenseSourceType;
  total: number;
  count: number;
}

export interface MonthlyExpenseSummary {
  month: number;
  year: number;
  summary: {
    totalExpenses: number;
    expenseCount: number;
    byCategory: CategoryExpenseBreakdown[];
    byType: TypeExpenseBreakdown[];
  };
  items: PresentedExpense[];
}

function formatExpense(
  record: Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>,
): PresentedExpense {
  return {
    ...record,
    type: record.sourceType,
  };
}

@Injectable()
export class ExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertLocation(
    businessId: string,
    locationId: string,
  ): Promise<void> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!location) {
      const anyLoc = await this.prisma.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (anyLoc && anyLoc.businessId && anyLoc.businessId !== businessId) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
      throw new NotFoundException('Branch location not found');
    }
  }

  async create(
    admin: AccessTokenPayload,
    dto: CreateExpenseDto,
  ): Promise<PresentedExpense> {
    const businessId = requireBusinessId(admin, dto.businessId);

    if (dto.locationId) {
      await this.assertLocation(businessId, dto.locationId);
    }

    let spentAt: Date;
    if (dto.spentAt) {
      const parsed = parseStrictEventInstant(dto.spentAt);
      if (parsed.isValid && parsed.date) {
        spentAt = parsed.date;
      } else {
        const dateOnly = parseDhakaDateString(dto.spentAt);
        if (dateOnly) {
          spentAt = dateOnly;
        } else {
          throw new BadRequestException(
            parsed.error ||
              'Invalid spentAt timestamp: must be an ISO 8601 instant with timezone or YYYY-MM-DD date',
          );
        }
      }
    } else {
      spentAt = new Date();
    }

    const created = await this.prisma.expense.create({
      data: {
        businessId,
        locationId: dto.locationId ?? null,
        userId: admin.sub,
        amount: dto.amount,
        title: dto.title.trim(),
        category: dto.category ?? ExpenseCategory.OTHER,
        sourceType: ExpenseSourceType.MANUAL,
        note: dto.note?.trim() || null,
        spentAt,
      },
      select: expenseSelect,
    });

    return formatExpense(created);
  }

  async update(
    admin: AccessTokenPayload,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<PresentedExpense> {
    const businessId = requireBusinessId(admin, dto.businessId);

    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, businessId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Expense not found');
    }

    if (
      existing.sourceType !== ExpenseSourceType.MANUAL ||
      existing.advanceId ||
      existing.payrollId
    ) {
      throw new BadRequestException(
        'Cannot manually update a system-managed expense (PAYROLL_NET). Only MANUAL expenses can be edited.',
      );
    }

    if (dto.locationId) {
      await this.assertLocation(businessId, dto.locationId);
    }

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.amount !== undefined) {
      data.amount = dto.amount;
    }
    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }
    if (dto.category !== undefined) {
      data.category = dto.category;
    }
    if (dto.note !== undefined) {
      data.note = dto.note.trim() || null;
    }
    if (dto.spentAt !== undefined) {
      const parsed = parseStrictEventInstant(dto.spentAt);
      if (parsed.isValid && parsed.date) {
        data.spentAt = parsed.date;
      } else {
        const dateOnly = parseDhakaDateString(dto.spentAt);
        if (dateOnly) {
          data.spentAt = dateOnly;
        } else {
          throw new BadRequestException(
            parsed.error ||
              'Invalid spentAt timestamp: must be an ISO 8601 instant with timezone or YYYY-MM-DD date',
          );
        }
      }
    }
    if (dto.locationId !== undefined) {
      data.location = dto.locationId
        ? { connect: { id: dto.locationId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data,
      select: expenseSelect,
    });

    return formatExpense(updated);
  }

  async remove(
    admin: AccessTokenPayload,
    expenseId: string,
    requestedBusinessId?: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = requireBusinessId(admin, requestedBusinessId);

    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, businessId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException('Expense not found');
    }

    if (
      existing.sourceType !== ExpenseSourceType.MANUAL ||
      existing.advanceId ||
      existing.payrollId
    ) {
      throw new BadRequestException(
        'Cannot manually delete a system-managed salary projection (SALARY_ADVANCE / PAYROLL_NET). Use the corresponding advance or payroll workflow.',
      );
    }

    const deletedAt = new Date();
    await this.prisma.expense.update({
      where: { id: expenseId },
      data: { deletedAt },
    });

    return { id: expenseId, deletedAt };
  }

  async summary(
    admin: AccessTokenPayload,
    query: ExpenseSummaryQueryDto,
  ): Promise<MonthlyExpenseSummary> {
    const businessId = requireBusinessId(admin, query.businessId);

    if (query.type === ('SALARY_ADVANCE' as any)) {
      throw new BadRequestException(
        'SALARY_ADVANCE is an obsolete expense type. Salary advances are tracked separately in the advance ledger.',
      );
    }

    const now = new Date();
    const currentPeriod = getDhakaDateParts(now);
    const month = query.month ?? currentPeriod.month;
    const year = query.year ?? currentPeriod.year;
    const { start, end } = payrollPeriod(year, month);

    const where: Prisma.ExpenseWhereInput = {
      businessId,
      deletedAt: null,
      spentAt: { gte: start, lt: end },
      // MVP POLICY: Public expenses only include MANUAL and PAYROLL_NET. Legacy SALARY_ADVANCE is excluded.
      sourceType: query.type
        ? query.type
        : { in: [ExpenseSourceType.MANUAL, ExpenseSourceType.PAYROLL_NET] },
    };

    if (query.locationId) {
      if (this.prisma.location?.findFirst) {
        const anyLoc = await this.prisma.location.findFirst({
          where: { id: query.locationId, deletedAt: null },
          select: { id: true, businessId: true },
        });
        if (anyLoc && anyLoc.businessId && anyLoc.businessId !== businessId) {
          throw new BadRequestException(
            'Location does not belong to the specified business',
          );
        }
      }
      where.locationId = query.locationId;
    }

    if (query.category) {
      where.category = query.category;
    }

    const [aggResult, rawItems] = await Promise.all([
      this.prisma.expense.aggregate
        ? this.prisma.expense.aggregate({
            where,
            _sum: { amount: true },
            _count: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.expense.findMany({
        where,
        select: expenseSelect,
        orderBy: { spentAt: 'desc' },
      }),
    ]);

    const items = rawItems.map(formatExpense);

    const totalExpenses =
      aggResult?._sum?.amount ??
      items.reduce((sum, item) => sum + item.amount, 0);

    const categoryMap = new Map<
      ExpenseCategory,
      { total: number; count: number }
    >();
    const typeMap = new Map<
      ExpenseSourceType,
      { total: number; count: number }
    >();

    for (const item of items) {
      const catCurrent = categoryMap.get(item.category) ?? {
        total: 0,
        count: 0,
      };
      categoryMap.set(item.category, {
        total: catCurrent.total + item.amount,
        count: catCurrent.count + 1,
      });

      const typeCurrent = typeMap.get(item.sourceType) ?? {
        total: 0,
        count: 0,
      };
      typeMap.set(item.sourceType, {
        total: typeCurrent.total + item.amount,
        count: typeCurrent.count + 1,
      });
    }

    const byCategory: CategoryExpenseBreakdown[] = Array.from(
      categoryMap.entries(),
    ).map(([category, stats]) => ({
      category,
      total: stats.total,
      count: stats.count,
    }));

    const byType: TypeExpenseBreakdown[] = Array.from(typeMap.entries()).map(
      ([type, stats]) => ({
        type,
        total: stats.total,
        count: stats.count,
      }),
    );

    return {
      month,
      year,
      summary: {
        totalExpenses,
        expenseCount: aggResult?._count?.id ?? items.length,
        byCategory,
        byType,
      },
      items,
    };
  }

  async list(
    admin: AccessTokenPayload,
    query: ListExpensesQueryDto,
  ): Promise<{
    items: PresentedExpense[];
    totalCount: number;
    totalAmount: number;
  }> {
    const businessId = requireBusinessId(admin, query.businessId);

    if (query.type === ('SALARY_ADVANCE' as any)) {
      throw new BadRequestException(
        'SALARY_ADVANCE is an obsolete expense type. Salary advances are tracked separately in the advance ledger.',
      );
    }

    const where: Prisma.ExpenseWhereInput = {
      businessId,
      deletedAt: null,
      // MVP POLICY: Public expenses only include MANUAL and PAYROLL_NET. Legacy SALARY_ADVANCE is excluded.
      sourceType: query.type
        ? query.type
        : { in: [ExpenseSourceType.MANUAL, ExpenseSourceType.PAYROLL_NET] },
    };

    if (query.locationId) {
      if (this.prisma.location?.findFirst) {
        const anyLoc = await this.prisma.location.findFirst({
          where: { id: query.locationId, deletedAt: null },
          select: { id: true, businessId: true },
        });
        if (anyLoc && anyLoc.businessId && anyLoc.businessId !== businessId) {
          throw new BadRequestException(
            'Location does not belong to the specified business',
          );
        }
      }
      where.locationId = query.locationId;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.month || query.year) {
      const now = new Date();
      const currentPeriod = getDhakaDateParts(now);
      const month = query.month ?? currentPeriod.month;
      const year = query.year ?? currentPeriod.year;
      const { start, end } = payrollPeriod(year, month);
      where.spentAt = { gte: start, lt: end };
    }

    if (query.search?.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { note: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const [aggResult, rawItems] = await Promise.all([
      this.prisma.expense.aggregate
        ? this.prisma.expense.aggregate({
            where,
            _sum: { amount: true },
            _count: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.expense.findMany({
        where,
        select: expenseSelect,
        orderBy: { spentAt: 'desc' },
      }),
    ]);

    const items = rawItems.map(formatExpense);

    const totalAmount =
      aggResult?._sum?.amount ??
      items.reduce((sum, item) => sum + item.amount, 0);

    return {
      items,
      totalCount: aggResult?._count?.id ?? items.length,
      totalAmount,
    };
  }
}
