import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { CloseShiftDto } from './dto/close-shift.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { ShiftService } from './shift.service';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CASHIER)
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Post('open')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Shift opened')
  open(@CurrentUser() cashier: AccessTokenPayload, @Body() dto: OpenShiftDto) {
    return this.shifts.open(cashier, dto);
  }

  @Post(':id/close')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Shift closed')
  close(
    @CurrentUser() cashier: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(cashier, id, dto);
  }
}
