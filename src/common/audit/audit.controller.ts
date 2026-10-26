import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ResponseMessage } from '../decorators/response-message.decorator';
import { Roles } from '../decorators/roles.decorator';
import type { AccessTokenPayload } from '../types/access-token-payload';
import { AuditReadService } from './audit-read.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audits: AuditReadService) {}
  @Get()
  @ResponseMessage('Audit logs loaded')
  @ApiOperation({ summary: '[ADMIN] List authorized business audit logs' })
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListAuditLogsQueryDto,
  ) {
    return this.audits.list(actor, query);
  }
  @Get(':id')
  @ResponseMessage('Audit log loaded')
  @ApiOperation({ summary: '[ADMIN] Get one authorized audit log' })
  get(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.audits.get(actor, id, businessId);
  }
}
