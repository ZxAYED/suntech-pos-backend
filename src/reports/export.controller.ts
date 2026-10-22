import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ExportReportQueryDto,
  ReportFormat,
  ReportType,
} from './dto/export-report.query';
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
  @ApiQuery({
    name: 'type',
    required: true,
    enum: ReportType,
    enumName: 'ReportType',
    description: 'Type of report to export (sales or payroll)',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: ReportFormat,
    enumName: 'ReportFormat',
    description: 'Format of the exported file (csv or pdf)',
  })
  @ApiQuery({
    name: 'month',
    required: true,
    type: Number,
    description: 'Report month (1-12)',
    example: 10,
  })
  @ApiQuery({
    name: 'year',
    required: true,
    type: Number,
    description: 'Report year',
    example: 2026,
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by branch location ID',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search term filter',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin validation',
    example: '123e4567-e89b-12d3-a456-426614174000',
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
