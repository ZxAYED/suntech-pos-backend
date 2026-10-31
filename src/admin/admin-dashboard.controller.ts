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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import {
  AdminDashboardService,
  DashboardInventoryAlertsResponse,
  DashboardOverviewResponse,
  DashboardRecentActivityResponse,
} from './admin-dashboard.service';
import { AdminDashboardRecentActivityQueryDto } from './dto/admin-dashboard-recent-activity.query';
import { AdminDashboardScopeQueryDto } from './dto/admin-dashboard-scope.query';

@ApiTags('Admin - Operations Dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CASHIER)
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get operational dashboard overview',
    description:
      'Returns today sales KPIs, orders count, refund totals, operational expense, net cashflow, and active cash drawer status for a branch.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard overview loaded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - missing businessId or locationId for Admin',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden - user does not own or have access to this business',
  })
  @ResponseMessage('Dashboard overview loaded')
  async getOverview(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: AdminDashboardScopeQueryDto,
  ): Promise<DashboardOverviewResponse> {
    return this.dashboardService.getOverview(actor, query);
  }

  @Get('inventory-alerts')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get low stock and out of stock SKU alerts',
    description:
      'Returns low stock count, out of stock count, and list of critical items below threshold for a branch.',
  })
  @ApiResponse({
    status: 200,
    description: 'Inventory alerts loaded successfully',
  })
  @ResponseMessage('Inventory alerts loaded')
  async getInventoryAlerts(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: AdminDashboardScopeQueryDto,
  ): Promise<DashboardInventoryAlertsResponse> {
    return this.dashboardService.getInventoryAlerts(actor, query);
  }

  @Get('recent-activity')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get recent live transaction tickets for branch',
    description:
      'Returns real-time list of latest transactions/tickets for the selected branch.',
  })
  @ApiResponse({
    status: 200,
    description: 'Recent activity loaded successfully',
  })
  @ResponseMessage('Recent activity loaded')
  async getRecentActivity(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: AdminDashboardRecentActivityQueryDto,
  ): Promise<DashboardRecentActivityResponse> {
    return this.dashboardService.getRecentActivity(actor, query);
  }
}
