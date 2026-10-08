import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TransactionLogQueryDto } from './dto/transaction-log.query';
import { ReportService } from './report.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('dashboard')
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Dashboard loaded')
  dashboard(@CurrentUser() actor: AccessTokenPayload) {
    return this.reports.dashboard(actor);
  }

  @Get('transactions')
  @Roles(Role.ADMIN)
  @ResponseMessage('Transactions loaded')
  transactions(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: TransactionLogQueryDto,
  ) {
    return this.reports.transactions(admin, query);
  }
}
