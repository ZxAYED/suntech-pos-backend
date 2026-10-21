import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AnalyticsQueryDto } from './dto/analytics.query';
import { DashboardQueryDto } from './dto/dashboard.query';
import { TransactionLogQueryDto } from './dto/transaction-log.query';
import { ReportService } from './report.service';

@ApiTags('Reports & Analytics')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get executive dashboard metrics',
    description:
      'Aggregates gross sales, net sales, refund deductions, order count, and payment method breakdown across today, yesterday, weekly, or monthly periods. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 200, description: 'Dashboard loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Dashboard loaded')
  dashboard(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.reports.dashboard(actor, query);
  }

  @Get('analytics')
  @ApiOperation({
    summary: '[ADMIN] Get business analytics & category performance',
    description:
      'Provides gross margin, revenue breakdown by payment method, top-selling categories, and period-over-period growth metrics (filtered by PAID orders only). Requires ADMIN role.',
  })
  @ApiResponse({ status: 200, description: 'Analytics loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Analytics loaded')
  analytics(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.reports.analytics(admin, query);
  }

  @Get('transactions')
  @ApiOperation({
    summary: '[ADMIN] Get consolidated transaction log',
    description:
      'Paginated chronological audit log of all orders, refunds, and tender methods across business locations. Requires ADMIN role.',
  })
  @ApiResponse({ status: 200, description: 'Transactions loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Transactions loaded')
  transactions(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: TransactionLogQueryDto,
  ) {
    return this.reports.transactions(admin, query);
  }
}
