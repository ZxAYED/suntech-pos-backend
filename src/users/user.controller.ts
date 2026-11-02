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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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

@ApiTags('Users & Staff')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({
    summary: '[AUTHENTICATED] Get current user profile',
    description:
      'Returns profile details for the authenticated user (Admin, Cashier, or Super Admin).',
  })
  @ApiResponse({ status: 200, description: 'Profile returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ResponseMessage('Profile loaded')
  getMe(@CurrentUser() user: AccessTokenPayload) {
    return this.userService.getMe(user.sub);
  }

  @Post('me/profile-image')
  @ApiOperation({
    summary: '[AUTHENTICATED] Upload current user profile image',
    description:
      'Uploads new profile photo to Cloudinary, updates profileImageUrl and key (profileImagePublicId / profileImageKey), and automatically deletes previous image from cloud storage.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Profile image updated; returns updated profile including profileImageUrl and key (profileImagePublicId / profileImageKey)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Profile image updated')
  setMyProfileImage(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.userService.setOwnProfileImage(user.sub, file);
  }

  @Delete('me/profile-image')
  @ApiOperation({
    summary: '[AUTHENTICATED] Remove current user profile image',
    description:
      'Deletes profile image from Cloudinary and clears profileImageUrl and key fields for current authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Profile image removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ResponseMessage('Profile image removed')
  clearMyProfileImage(@CurrentUser() user: AccessTokenPayload) {
    return this.userService.clearOwnProfileImage(user.sub);
  }

  @Post('cashiers')
  @ApiOperation({
    summary: '[ADMIN] Create new cashier staff account',
    description:
      'Creates a cashier account for the business. Auto-generates publicId (CSH-XXXXX) and synthetic internal email if omitted. Requires ADMIN role.',
  })
  @ApiResponse({ status: 201, description: 'Cashier created successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'Phone number already in use within this business',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Cashier created')
  createCashier(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateCashierDto,
  ) {
    return this.userService.createCashier(admin, dto);
  }

  @Get('cashiers')
  @ApiOperation({
    summary: '[ADMIN] List cashiers in business',
    description:
      'Returns all non-deleted cashiers with optional location/search filters. Requires ADMIN role.',
  })
  @ApiResponse({ status: 200, description: 'Cashiers list returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Cashiers loaded')
  listCashiers(
    @CurrentUser() admin: AccessTokenPayload,
    @Query() query: ListCashiersQueryDto,
  ) {
    return this.userService.listCashiers(admin, query);
  }

  @Patch('cashiers/:id')
  @ApiOperation({
    summary: '[ADMIN] Update cashier account details',
    description:
      'Update name, phone, branch location, salary, or reset password. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Cashier user UUID' })
  @ApiResponse({ status: 200, description: 'Cashier updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Cashier not found' })
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
  @ApiOperation({
    summary: '[ADMIN] Soft-delete cashier account',
    description:
      'Soft-deletes cashier account (verifying no active open shift). Suffixes phone and email to release uniqueness. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Cashier user UUID' })
  @ApiResponse({ status: 200, description: 'Cashier soft-deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete cashier with active open shift',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Target business UUID for multi-business Admin',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Cashier deleted')
  deleteCashier(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.userService.deleteCashier(admin, id, businessId);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: '[ADMIN] Update employee account status',
    description:
      'Updates account status (ACTIVE, SUSPENDED, REJECTED). Prevents self-suspension. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Employee user UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Target business UUID for multi-business Admin',
  })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 400, description: 'Cannot suspend own admin account' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('User status updated')
  updateStatus(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.userService.updateStatus(admin, id, dto, businessId);
  }

  @Post(':id/profile-image')
  @ApiOperation({
    summary: '[ADMIN] Upload staff profile image',
    description:
      'Uploads new profile photo to Cloudinary for an employee, updates profileImageUrl and key (profileImagePublicId / profileImageKey), and automatically deletes previous image from cloud storage. Requires ADMIN role.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'Employee user UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Target business UUID for multi-business Admin',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Profile image updated; returns updated profile including profileImageUrl and key (profileImagePublicId / profileImageKey)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Profile image updated')
  setStaffProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage,
    @Query('businessId') businessId?: string,
  ) {
    return this.userService.setStaffProfileImage(admin, id, file, businessId);
  }

  @Delete(':id/profile-image')
  @ApiOperation({
    summary: '[ADMIN] Remove staff profile image',
    description:
      'Deletes profile image from Cloudinary and clears profileImageUrl and key fields for an employee. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Employee user UUID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Target business UUID for multi-business Admin',
  })
  @ApiResponse({ status: 200, description: 'Profile image removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Profile image removed')
  clearStaffProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.userService.clearStaffProfileImage(admin, id, businessId);
  }
}
