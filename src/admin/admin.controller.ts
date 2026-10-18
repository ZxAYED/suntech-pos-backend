import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { AdminService } from './admin.service';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ResponseMessage('Admin accounts loaded')
  list(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.list(query);
  }

  @Patch(':id/approve')
  @Idempotent()
  @ResponseMessage('Admin account approved')
  approve(@Param('id') id: string) {
    return this.adminService.approve(id);
  }

  @Patch(':id/status')
  @ResponseMessage('Admin status updated')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.adminService.updateStatus(id, dto);
  }
}
