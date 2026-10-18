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

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('summary')
  @ResponseMessage('Payroll summary loaded')
  summary(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.summary(admin, query);
  }

  @Post('disburse')
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
  @ResponseMessage('Payroll history loaded')
  history(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.list(admin, query);
  }

  @Get()
  @ResponseMessage('Payroll history loaded')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.list(admin, query);
  }
}
