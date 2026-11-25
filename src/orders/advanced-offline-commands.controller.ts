import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { AdvancedOfflineCommandsService } from './advanced-offline-commands.service';

@Controller('offline/commands')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CASHIER')
export class AdvancedOfflineCommandsController {
  constructor(private readonly service: AdvancedOfflineCommandsService) {}
  @Post('v1')
  @HttpCode(200)
  @ResponseMessage('Original offline command result loaded')
  post(@CurrentUser() actor: AccessTokenPayload, @Body() body: unknown) {
    // Parse exact fields and types in the service; do not implicitly coerce financial input.
    return this.service.post(actor, body);
  }
}
