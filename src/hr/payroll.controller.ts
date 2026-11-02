import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DisbursePayrollDto } from './dto/disburse-payroll.dto';
import { PayrollHistoryQueryDto } from './dto/payroll-history.query';
import { ProcessPayrollDto } from './dto/process-payroll.dto';
import { PayrollService } from './payroll.service';

@ApiTags('HR - Payroll')
@ApiBearerAuth()
@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('summary')
  @ApiOperation({
    summary: '[ADMIN] Get monthly payroll disbursement summary',
    description:
      'Pre-flight calculation of total base salary and net payable for eligible active cashiers. Per owner policy, advances are tracked separately in the advance ledger. Requires ADMIN role.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Payroll month (1-12)',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Payroll year (e.g. 2026)',
    example: 2026,
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by branch location ID',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin validation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Payroll summary loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ResponseMessage('Payroll summary loaded')
  summary(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.summary(admin, query);
  }

  @Post('disburse')
  @ApiOperation({
    summary: '[ADMIN] Batch disburse monthly payroll',
    description:
      'Processes payroll for all active cashiers (or filtered by locationId). Generates paid payroll ledger entries and linked PAYROLL_NET expenses. Per owner policy, advances are tracked separately in the advance ledger. Requires ADMIN role.',
  })
  @ApiResponse({ status: 200, description: 'Payroll disbursed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 400, description: 'Disbursement validation error' })
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Payroll disbursed')
  disburse(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: DisbursePayrollDto,
  ) {
    return this.payroll.disburse(admin, dto);
  }

  @Post('process')
  @ApiOperation({
    summary: '[ADMIN] Process single cashier payroll',
    description:
      'Processes payroll for an individual cashier for the specified month, generating a paid payroll ledger entry and linked PAYROLL_NET expense. Per owner policy, advances are tracked separately in the advance ledger. Requires ADMIN role.',
  })
  @ApiResponse({ status: 201, description: 'Payroll processed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 400,
    description: 'Payroll already processed or validation error',
  })
  @ApiResponse({ status: 404, description: 'Cashier not found' })
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Payroll processed')
  process(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: ProcessPayrollDto,
  ) {
    return this.payroll.process(admin, dto);
  }

  @Get('history')
  @ApiOperation({
    summary: '[ADMIN] Get historical payroll records',
    description:
      'Lists finalized payroll records with filters for month, year, location, and business. Requires ADMIN role.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Payroll month (1-12)',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Payroll year (e.g. 2026)',
    example: 2026,
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by branch location ID',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin validation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Payroll history loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ResponseMessage('Payroll history loaded')
  history(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.list(admin, query);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN] List historical payroll records',
    description: 'Alias route for payroll history. Requires ADMIN role.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Payroll month (1-12)',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: false,
    description: 'Payroll year (e.g. 2026)',
    example: 2026,
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by branch location ID',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin validation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Payroll history loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ResponseMessage('Payroll history loaded')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.list(admin, query);
  }
}
