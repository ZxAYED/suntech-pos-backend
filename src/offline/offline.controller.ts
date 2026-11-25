import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { OfflineCapabilityService } from './offline-capability.service';
import { ProvisionOfflineDto } from './provision-offline.dto';

@ApiTags('Offline PWA')
@ApiBearerAuth()
@Controller('offline')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.CASHIER)
export class OfflineController {
  constructor(
    private readonly offlineService: OfflineService,
    private readonly capabilities: OfflineCapabilityService,
  ) {}

  @Post('provision')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ResponseMessage('Device permission and complete snapshot loaded')
  async provision(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: ProvisionOfflineDto,
  ) {
    const permission = await this.capabilities.provision(actor, dto);
    const bootstrap = await this.offlineService.bootstrapV2(actor, dto);
    return { ...permission, bootstrap };
  }

  @Get('bootstrap')
  @Header('Cache-Control', 'no-store')
  @ResponseMessage('Offline checkout snapshot loaded')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Download offline checkout bootstrap snapshot',
  })
  @ApiResponse({ status: 200, description: 'Offline snapshot returned' })
  bootstrap(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: OfflineContextQueryDto,
  ) {
    if (query.deviceId)
      return this.offlineService.bootstrapV2(actor, {
        ...query,
        deviceId: query.deviceId,
      });
    return this.offlineService.bootstrap(actor, query);
  }
}
