import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseCategory, Prisma, Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { payrollPeriod } from '../hr/payroll-period';
import { requireBusinessId } from '../hr/require-business-id';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseSummaryQueryDto } from './dto/expense-summary.query';
import { ListExpensesQueryDto } from './dto/list-expenses.query';

const expenseSelect = {
  id: true,
  businessId: true,
  locationId: true,
  userId: true,
  amount: true,
  title: true,
  category: true,
  note: true,
  spentAt: true,
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
} satisfies Prisma.ExpenseSelect;

export type PresentedExpense = Prisma.ExpenseGetPayload<{
  select: typeof expenseSelect;
}>;

export interface CategoryExpenseBreakdown {
  category: ExpenseCategory;
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
  };
  items: PresentedExpense[];
}

@Injectable()
export class ExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    admin: AccessTokenPayload,
    dto: CreateExpenseDto,
  ): Promise<PresentedExpense> {
    const businessId = requireBusinessId(admin, dto.businessId);

    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, businessId, deletedAt: null },
      });
      if (!location) {
        throw new NotFoundException('Branch location not found');
      }
    }

    const spentAt = dto.spentAt ? new Date(dto.spentAt) : new Date();

    return this.prisma.expense.create({
      data: {
        businessId,
        locationId: dto.locationId ?? null,
        userId: admin.sub,
        amount: dto.amount,
        title: dto.title.trim(),
        category: dto.category ?? ExpenseCategory.OTHER,
        note: dto.note?.trim() || null,
        spentAt,
      },
      select: expenseSelect,
    });
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

    const now = new Date();
    const month = query.month ?? now.getUTCMonth() + 1;
    const year = query.year ?? now.getUTCFullYear();
    const { start, end } = payrollPeriod(year, month);

    const where: Prisma.ExpenseWhereInput = {
      businessId,
      deletedAt: null,
      spentAt: { gte: start, lt: end },
    };

    if (query.locationId) {
      where.locationId = query.locationId;
    }

    if (query.category) {
      where.category = query.category;
    }

    const items = await this.prisma.expense.findMany({
      where,
      select: expenseSelect,
      orderBy: { spentAt: 'desc' },
    });

    const totalExpenses = items.reduce((sum, item) => sum + item.amount, 0);

    const breakdownMap = new Map<ExpenseCategory, { total: number; count: number }>();
    for (const item of items) {
      const current = breakdownMap.get(item.category) ?? { total: 0, count: 0 };
      breakdownMap.set(item.category, {
        total: current.total + item.amount,
        count: current.count + 1,
      });
    }

    const byCategory: CategoryExpenseBreakdown[] = Array.from(
      breakdownMap.entries(),
    ).map(([category, stats]) => ({
      category,
      total: stats.total,
      count: stats.count,
    }));

    return {
      month,
      year,
      summary: {
        totalExpenses,
        expenseCount: items.length,
        byCategory,
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

    const where: Prisma.ExpenseWhereInput = {
      businessId,
      deletedAt: null,
    };

    if (query.locationId) {
      where.locationId = query.locationId;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.month || query.year) {
      const now = new Date();
      const month = query.month ?? now.getUTCMonth() + 1;
      const year = query.year ?? now.getUTCFullYear();
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

    const items = await this.prisma.expense.findMany({
      where,
      select: expenseSelect,
      orderBy: { spentAt: 'desc' },
    });

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    return {
      items,
      totalCount: items.length,
      totalAmount,
    };
  }
}
