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
import { PayrollHistoryQueryDto } from './dto/payroll-history.query';
import { ProcessPayrollDto } from './dto/process-payroll.dto';
import { PayrollService } from './payroll.service';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

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

  @Get()
  @ResponseMessage('Payroll history loaded')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: PayrollHistoryQueryDto,
  ) {
    return this.payroll.list(admin, query);
  }
}
