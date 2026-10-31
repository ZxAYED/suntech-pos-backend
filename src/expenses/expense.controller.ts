import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ExpenseCategory, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseSummaryQueryDto } from './dto/expense-summary.query';
import { ListExpensesQueryDto } from './dto/list-expenses.query';
import { ExpenseService } from './expense.service';

@ApiTags('Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expenses')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post()
  @Roles(Role.ADMIN)
  @Idempotent()
  @ApiOperation({
    summary: 'Record a business/operational expense (Admin Ledger)',
    description:
      'Enables store admin to record operational expenses (e.g. rent, utilities, supplies) under their business or branch location.',
  })
  @ApiResponse({ status: 201, description: 'Expense recorded successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden / Unauthorized business',
  })
  @ResponseMessage('Expense recorded successfully')
  create(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expenseService.create(admin, dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List expenses with multi-filtering and search',
    description:
      'Retrieve expenses filtered by month, year, location, category, or search keywords. Excludes soft-deleted items.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Calendar month (1-12) to filter expenses',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Calendar year to filter expenses',
    example: 2026,
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter expenses by branch location',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ExpenseCategory,
    enumName: 'ExpenseCategory',
    description: 'Filter expenses by category',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Keyword search in expense title or note',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business ID for multi-business admins',
  })
  @ApiResponse({ status: 200, description: 'Expenses retrieved successfully' })
  @ResponseMessage('Expenses retrieved successfully')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expenseService.list(admin, query);
  }

  @Get('summary')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Get monthly expense ledger summary (No salary deduction)',
    description:
      'Calculates total expenses and category breakdowns for a given month. Does not perform salary deductions, and excludes soft-deleted records.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Calendar month (1-12). Defaults to current month.',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Calendar year. Defaults to current year.',
    example: 2026,
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter expense summary by branch location',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ExpenseCategory,
    enumName: 'ExpenseCategory',
    description: 'Filter expense summary by category',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business ID for multi-business admins',
  })
  @ApiResponse({
    status: 200,
    description: 'Expense summary retrieved successfully',
  })
  @ResponseMessage('Expense summary retrieved successfully')
  summary(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: ExpenseSummaryQueryDto,
  ) {
    return this.expenseService.summary(admin, query);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Soft-delete an expense',
    description:
      'Performs a soft delete on an expense entry. Soft-deleted expenses are not counted in monthly summaries.',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business ID if managing multiple businesses',
  })
  @ApiResponse({ status: 200, description: 'Expense deleted successfully' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  @ResponseMessage('Expense deleted successfully')
  remove(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.expenseService.remove(admin, id, businessId);
  }
}
