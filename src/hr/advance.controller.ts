import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdvanceStatus, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdvanceService } from './advance.service';
import { AdvanceSummaryQueryDto } from './dto/advance-summary.query';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { ListAdvancesQueryDto } from './dto/list-advances.query';

@ApiTags('HR - Employee Advances')
@ApiBearerAuth()
@Controller('advances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdvanceController {
  constructor(private readonly advances: AdvanceService) {}

  @Post()
  @ApiOperation({
    summary: '[CASHIER] Record employee salary advance',
    description:
      'Cashiers can input fee/advance amount with a note (reason) to immediately record a salary advance. No admin approval is required; it is auto-added to the ledger history (status PENDING until monthly payroll settlement). Only cashiers can create advances. Admin can view history, summary, and delete. Enforces atomic salary cap check: total pending advances for current payroll month cannot exceed employee monthlySalary.',
  })
  @ApiResponse({ status: 201, description: 'Advance recorded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - only CASHIER role can record salary advances',
  })
  @ApiResponse({
    status: 400,
    description:
      'Advance amount exceeds remaining monthly salary limit or cashier has no salary configured',
  })
  @Roles(Role.CASHIER)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Advance recorded')
  create(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.advances.create(actor, dto);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List employee advances with filters',
    description:
      'Cashiers see only their own advances; Admins see business-wide advances filterable by branch location, cashier, month, and year. Accessible by CASHIER and ADMIN.',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by branch location ID',
  })
  @ApiQuery({
    name: 'cashierId',
    required: false,
    description: 'Filter by employee / cashier ID',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Month (1-12)',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Year (e.g. 2026)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: AdvanceStatus,
    enumName: 'AdvanceStatus',
    description: 'Filter by advance status (PENDING, DEDUCTED)',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Advances loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Advances loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListAdvancesQueryDto,
  ) {
    return this.advances.list(actor, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get monthly advance summary',
    description:
      'Calculates total pending advance amounts strictly for the given month and year, strictly excluding any soft-deleted advances. Cashiers see their own monthly advance summary and remaining net payable. Admins can view a specific cashier summary via ?cashierId= or view the business-wide monthly summary when cashierId is omitted.',
  })
  @ApiQuery({
    name: 'cashierId',
    required: false,
    description: 'Filter advance summary by cashier ID (Admin only)',
  })
  @ApiQuery({
    name: 'month',
    required: true,
    description: 'Month number (1-12)',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: true,
    description: 'Year (e.g. 2026)',
    example: 2026,
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Advance summary loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Advance summary loaded')
  summary(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: AdvanceSummaryQueryDto,
  ) {
    return this.advances.summary(actor, query);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[ADMIN] Soft-delete pending advance',
    description:
      'Admin soft-deletes a pending advance that has not yet been deducted in payroll. Excludes it from monthly summary and payroll deduction. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Advance ID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Advance removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete already deducted advance',
  })
  @ApiResponse({ status: 404, description: 'Advance not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Advance removed')
  remove(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.advances.remove(actor, id, businessId);
  }
}
