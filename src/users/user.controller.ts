import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { CreateCashierDto } from './dto/create-cashier.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserService } from './user.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ResponseMessage('Profile loaded')
  getMe(@CurrentUser() user: AccessTokenPayload) {
    return this.userService.getMe(user.sub);
  }

  @Post('cashiers')
  @Roles(Role.ADMIN)
  @Idempotent()
  @ResponseMessage('Cashier created')
  createCashier(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateCashierDto,
  ) {
    return this.userService.createCashier(admin, dto);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ResponseMessage('User status updated')
  updateStatus(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.userService.updateStatus(admin, id, dto);
  }
}
