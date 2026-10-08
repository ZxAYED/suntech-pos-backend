import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ExportReportQueryDto } from './dto/export-report.query';
import { ExportService } from './export.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get('export')
  exportReport(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: ExportReportQueryDto,
  ) {
    return this.exports.export(admin, query);
  }
}
