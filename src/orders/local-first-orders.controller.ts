import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import {
  SyncV2OrdersDto,
  SyncV2StatusDto,
  ValidateLocalSaleDto,
} from './dto/sync-v2.dto';
import { LocalFirstOrdersService } from './local-first-orders.service';

@ApiTags('Local-first orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CASHIER')
export class LocalFirstOrdersController {
  constructor(private readonly localFirst: LocalFirstOrdersService) {}

  @Post('sync-v2')
  @HttpCode(200)
  @ResponseMessage('Local sale results loaded')
  sync(@CurrentUser() actor: AccessTokenPayload, @Body() dto: SyncV2OrdersDto) {
    return this.localFirst.sync(actor, dto);
  }

  @Post('sync-v2/validate')
  @HttpCode(200)
  @ResponseMessage('Current checkout fields validated')
  validate(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: ValidateLocalSaleDto,
  ) {
    return this.localFirst.validateCurrent(actor, dto);
  }

  @Post('sync-v2/status')
  @HttpCode(200)
  @ResponseMessage('Local sale status loaded')
  status(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: SyncV2StatusDto,
  ) {
    return this.localFirst.status(actor, dto);
  }

  @Get('legacy-status/:key')
  @Header('Cache-Control', 'no-store')
  @ResponseMessage('Original checkout recovery status loaded')
  legacyStatus(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('key') key: string,
  ) {
    return this.localFirst.legacyStatus(actor, key);
  }
}
