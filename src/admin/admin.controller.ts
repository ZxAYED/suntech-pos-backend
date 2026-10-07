import { Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Patch(':id/approve')
  @Idempotent()
  @ResponseMessage('Admin account approved')
  approve(@Param('id') id: string) {
    return this.adminService.approve(id);
  }
}
