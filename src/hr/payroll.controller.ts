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
      'Pre-flight calculation of total base salary, deducted advances, and net payable for eligible active cashiers. Requires ADMIN role.',
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
      'Processes payroll for all active cashiers (or filtered by locationId). Deducts pending advances and generates paid payroll ledger entries. Requires ADMIN role.',
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
      'Processes and settles payroll and advances for an individual cashier for the specified month. Requires ADMIN role.',
  })
  @ApiResponse({ status: 201, description: 'Payroll processed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 400,
    description: 'Advances exceed salary or already processed',
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
      'Lists finalized payroll records with filters for month, year, and location. Requires ADMIN role.',
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
