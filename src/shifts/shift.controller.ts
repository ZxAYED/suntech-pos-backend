import {
  Body,
  Controller,
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
import { CloseShiftDto } from './dto/close-shift.dto';
import { CreateShiftAdvanceDto } from './dto/create-shift-advance.dto';
import { ListShiftsQueryDto } from './dto/list-shifts.query';
import { OpenShiftDto } from './dto/open-shift.dto';
import { ShiftService } from './shift.service';

@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CASHIER, Role.ADMIN)
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Post('open')
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Shift opened')
  open(@CurrentUser() actor: AccessTokenPayload, @Body() dto: OpenShiftDto) {
    return this.shifts.open(actor, dto);
  }

  @Get('active')
  @Roles(Role.CASHIER, Role.ADMIN)
  @ResponseMessage('Active shift loaded')
  getActive(@CurrentUser() actor: AccessTokenPayload) {
    return this.shifts.getActive(actor);
  }

  @Post('close')
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Shift closed')
  closeActive(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(actor, undefined, dto);
  }

  @Post(':id/close')
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Shift closed')
  close(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(actor, id, dto);
  }

  @Post('advances')
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Shift advance recorded')
  addAdvance(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateShiftAdvanceDto,
  ) {
    return this.shifts.addAdvance(actor, dto);
  }

  @Get()
  @Roles(Role.CASHIER, Role.ADMIN)
  @ResponseMessage('Shifts loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListShiftsQueryDto,
  ) {
    return this.shifts.list(actor, query);
  }
}
