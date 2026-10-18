import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  imageUploadOptions,
  type UploadedImage,
} from '../media/uploaded-image';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { ListCashiersQueryDto } from './dto/list-cashiers.query';
import { UpdateCashierDto } from './dto/update-cashier.dto';
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

  @Post('me/profile-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Profile image updated')
  setMyProfileImage(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.userService.setOwnProfileImage(user.sub, file);
  }

  @Delete('me/profile-image')
  @ResponseMessage('Profile image removed')
  clearMyProfileImage(@CurrentUser() user: AccessTokenPayload) {
    return this.userService.clearOwnProfileImage(user.sub);
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

  @Get('cashiers')
  @Roles(Role.ADMIN)
  @ResponseMessage('Cashiers loaded')
  listCashiers(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: ListCashiersQueryDto,
  ) {
    return this.userService.listCashiers(admin, query);
  }

  @Patch('cashiers/:id')
  @Roles(Role.ADMIN)
  @ResponseMessage('Cashier updated')
  updateCashier(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCashierDto,
  ) {
    return this.userService.updateCashier(admin, id, dto);
  }

  @Delete('cashiers/:id')
  @Roles(Role.ADMIN)
  @ResponseMessage('Cashier deleted')
  deleteCashier(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.userService.deleteCashier(admin, id);
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

  @Post(':id/profile-image')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Profile image updated')
  setStaffProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.userService.setStaffProfileImage(admin, id, file);
  }

  @Delete(':id/profile-image')
  @Roles(Role.ADMIN)
  @ResponseMessage('Profile image removed')
  clearStaffProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.userService.clearStaffProfileImage(admin, id);
  }
}
