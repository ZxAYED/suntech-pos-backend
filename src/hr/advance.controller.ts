import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdvanceService } from './advance.service';
import { AdvanceSummaryQueryDto } from './dto/advance-summary.query';
import { CreateAdvanceDto } from './dto/create-advance.dto';

@Controller('advances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdvanceController {
  constructor(private readonly advances: AdvanceService) {}

  @Post()
  @Roles(Role.ADMIN, Role.CASHIER)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Advance recorded')
  create(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.advances.create(actor, dto);
  }

  @Get('summary')
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Advance summary loaded')
  summary(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: AdvanceSummaryQueryDto,
  ) {
    return this.advances.summary(actor, query);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ResponseMessage('Advance removed')
  remove(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.advances.remove(actor, id);
  }
}
