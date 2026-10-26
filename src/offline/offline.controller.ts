import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { OfflineService } from './offline.service';
import { OfflineContextQueryDto } from './offline-context.query';

@ApiTags('Offline PWA')
@ApiBearerAuth()
@Controller('offline')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.CASHIER)
export class OfflineController {
  constructor(private readonly offlineService: OfflineService) {}

  @Get('bootstrap')
  @ResponseMessage('Offline checkout snapshot loaded')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Download offline checkout bootstrap snapshot',
  })
  @ApiResponse({ status: 200, description: 'Offline snapshot returned' })
  bootstrap(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: OfflineContextQueryDto,
  ) {
    return this.offlineService.bootstrap(actor, query);
  }
}
