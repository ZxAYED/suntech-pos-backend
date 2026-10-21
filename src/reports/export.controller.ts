import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ExportReportQueryDto } from './dto/export-report.query';
import { ExportService } from './export.service';

@ApiTags('Reports & Analytics')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get('export')
  @ApiOperation({
    summary: '[ADMIN] Export report data to CSV or PDF',
    description:
      'Generates tabular CSV or structured PDF export for sales or payroll report types. Requires ADMIN role.',
  })
  @ApiResponse({ status: 200, description: 'File exported successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 400, description: 'Invalid export parameters' })
  exportReport(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: ExportReportQueryDto,
  ) {
    return this.exports.export(admin, query);
  }
}
