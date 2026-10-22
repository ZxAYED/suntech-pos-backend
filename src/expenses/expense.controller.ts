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
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
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
  @ApiOperation({
    summary: 'Record a business/operational expense (Admin Ledger)',
    description:
      'Enables store admin to record operational expenses (e.g. rent, utilities, supplies) under their business or branch location.',
  })
  @ApiResponse({ status: 201, description: 'Expense recorded successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 403, description: 'Forbidden / Unauthorized business' })
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
  @ApiResponse({ status: 200, description: 'Expense summary retrieved successfully' })
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
