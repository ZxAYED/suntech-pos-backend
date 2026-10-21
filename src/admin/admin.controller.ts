import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { AdminService } from './admin.service';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query';

@ApiTags('Super Admin - User Approvals')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({
    summary: '[SUPER_ADMIN] List admin registration requests',
    description:
      'Super Admin list of registered Admin accounts with status filter (PENDING_APPROVAL, ACTIVE, etc.). Requires SUPER_ADMIN role.',
  })
  @ApiResponse({ status: 200, description: 'Admin accounts returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires SUPER_ADMIN role',
  })
  @ResponseMessage('Admin accounts loaded')
  list(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.list(query);
  }

  @Patch(':id/approve')
  @ApiOperation({
    summary: '[SUPER_ADMIN] Approve pending admin registration',
    description:
      'Approves pending admin, generates their publicId (ADM-XXXXX), and activates their account. Requires SUPER_ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Admin user UUID to approve' })
  @ApiResponse({
    status: 200,
    description: 'Admin account approved and activated',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires SUPER_ADMIN role',
  })
  @ApiResponse({ status: 404, description: 'Pending admin account not found' })
  @Idempotent()
  @ResponseMessage('Admin account approved')
  approve(@Param('id') id: string) {
    return this.adminService.approve(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: '[SUPER_ADMIN] Update admin account status',
    description:
      'Update status of an admin account (SUSPENDED, REJECTED, ACTIVE). Requires SUPER_ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Admin user UUID' })
  @ApiResponse({ status: 200, description: 'Admin account status updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires SUPER_ADMIN role',
  })
  @ApiResponse({ status: 404, description: 'Admin account not found' })
  @ResponseMessage('Admin status updated')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.adminService.updateStatus(id, dto);
  }
}
