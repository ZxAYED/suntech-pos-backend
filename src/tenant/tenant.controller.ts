import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { TenantService } from './tenant.service';

@ApiTags('Tenancy & Locations')
@ApiBearerAuth()
@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('businesses')
  @ApiOperation({
    summary: '[ADMIN] List all businesses owned by admin',
    description:
      'Returns all non-deleted businesses owned by the authenticated admin, including their branch locations.',
  })
  @ApiResponse({ status: 200, description: 'List of owned businesses' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Businesses loaded')
  listBusinesses(@CurrentUser() admin: AccessTokenPayload) {
    return this.tenantService.listBusinesses(admin);
  }

  @Post('business')
  @ApiOperation({
    summary: '[ADMIN] Create business tenant profile',
    description:
      'Creates a new business owned by the authenticated admin. Requires ADMIN role.',
  })
  @ApiResponse({
    status: 201,
    description: 'Business created successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'A business with this name already exists for this admin',
  })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Business created')
  createBusiness(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateBusinessDto,
  ) {
    return this.tenantService.createBusiness(admin, dto);
  }

  @Patch('businesses/:id')
  @ApiOperation({
    summary: '[ADMIN] Update business profile',
    description:
      'Allows an Admin to update business details such as name. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Business UUID to update' })
  @ApiResponse({ status: 200, description: 'Business updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 404,
    description: 'Business not found or access denied',
  })
  @ApiResponse({
    status: 409,
    description: 'A business with this name already exists',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Business updated')
  updateBusiness(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.tenantService.updateBusiness(admin, id, dto);
  }

  @Delete('businesses/:id')
  @ApiOperation({
    summary: '[ADMIN] Delete business profile by ID',
    description:
      'Soft-deletes a business if no active branches exist. Rejects with 409 Conflict if any active branch locations exist. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Business UUID to delete' })
  @ApiResponse({ status: 200, description: 'Business deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 404,
    description: 'Business not found or access denied',
  })
  @ApiResponse({
    status: 409,
    description:
      'Cannot delete business with existing branch locations. Please delete all branches first.',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Business deleted')
  deleteBusiness(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.tenantService.deleteBusiness(admin, id);
  }

  @Delete('business')
  @ApiOperation({
    summary: '[ADMIN] Delete active or query-specified business profile',
    description:
      'Soft-deletes a business if no active branches exist. Target business is specified via query ?businessId= or defaults to the Admin active business from JWT. Rejects with 409 Conflict if any active branch locations exist. Requires ADMIN role.',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Target business UUID (optional; defaults to Admin active business)',
  })
  @ApiResponse({ status: 200, description: 'Business deleted' })
  @ApiResponse({
    status: 400,
    description: 'Business ID could not be resolved',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 404,
    description: 'Business not found or access denied',
  })
  @ApiResponse({
    status: 409,
    description:
      'Cannot delete business with existing branch locations. Please delete all branches first.',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Business deleted')
  deleteActiveBusiness(
    @CurrentUser() admin: AccessTokenPayload,
    @Query('businessId') queryBusinessId?: string,
  ) {
    const businessId = queryBusinessId || admin.businessId;
    if (!businessId) {
      throw new BadRequestException(
        'Business ID is required. Please provide ?businessId=.',
      );
    }
    return this.tenantService.deleteBusiness(admin, businessId);
  }

  @Get('business')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get business tenant profile',
    description:
      'Returns business profile details. Cashiers automatically receive their assigned business from token. Admins receive their business specified via query ?businessId= (or default owned business).',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is always locked to assigned business from token',
  })
  @ApiResponse({ status: 200, description: 'Business profile returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Business profile loaded')
  getBusiness(
    @CurrentUser() actor: AccessTokenPayload,
    @Query('businessId') queryBusinessId?: string,
  ) {
    return this.tenantService.getBusinessProfile(actor, queryBusinessId);
  }

  @Post('locations')
  @ApiOperation({
    summary: '[ADMIN] Create branch location',
    description:
      'Creates a new branch location for the specified business. Name, address, and businessId are combinely unique. Pass "businessId" in request body.',
  })
  @ApiResponse({ status: 201, description: 'Location created' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description:
      'A branch location with that name and address already exists in this business',
  })
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Location created')
  createLocation(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateLocationDto,
  ) {
    return this.tenantService.createLocation(admin, dto);
  }

  @Get('locations')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List store branch locations',
    description:
      'Returns locations for the business. Cashiers are strictly scoped to their assigned branch from token. Admins can view locations for their business by querying ?businessId= (or default owned business).',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter by specific branch location UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search location by branch name or address',
    example: 'Uttara',
  })
  @ApiResponse({ status: 200, description: 'Locations list returned' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Locations loaded')
  getLocations(
    @CurrentUser() actor: AccessTokenPayload,
    @Query('businessId') queryBusinessId?: string,
    @Query('locationId') locationId?: string,
    @Query('search') search?: string,
  ) {
    return this.tenantService.getLocations(
      actor,
      queryBusinessId,
      locationId,
      search,
    );
  }

  @Patch('locations/:id')
  @ApiOperation({
    summary: '[ADMIN] Update branch location',
    description:
      'Updates location name or address with tenant uniqueness checks. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Branch location UUID' })
  @ApiResponse({ status: 200, description: 'Location updated' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'A location with that name already exists',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Location updated')
  updateLocation(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.tenantService.updateLocation(admin, id, dto);
  }

  @Delete('locations/:id')
  @ApiOperation({
    summary: '[ADMIN] Delete branch location',
    description:
      'Soft-deletes location if no open shifts exist at that location. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Branch location UUID' })
  @ApiResponse({ status: 200, description: 'Location deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete location with an active open shift',
  })
  @Roles(Role.ADMIN)
  @ResponseMessage('Location deleted')
  deleteLocation(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.tenantService.deleteLocation(admin, id);
  }

  @Post('business/profile-image')
  @ApiOperation({
    summary: '[ADMIN] Upload business logo/image',
    description:
      'Uploads new business logo to Cloudinary, sets profileImageUrl and key (profileImagePublicId / profileImageKey), and automatically deletes previous image from cloud storage. Requires ADMIN role.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Target business UUID (optional for Admin; defaults to active business)',
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
      'Business logo uploaded; returns profileImageUrl and key (profileImagePublicId / profileImageKey)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Business image updated')
  setBusinessProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @UploadedFile() file: UploadedImage,
    @Query('businessId') queryBusinessId?: string,
  ) {
    return this.tenantService.setBusinessProfileImage(
      admin,
      file,
      queryBusinessId,
    );
  }

  @Delete('business/profile-image')
  @ApiOperation({
    summary: '[ADMIN] Remove business logo/image',
    description:
      'Deletes business logo from Cloudinary and clears profileImageUrl and key fields. Requires ADMIN role.',
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Target business UUID (optional for Admin; defaults to owned business)',
  })
  @ApiResponse({ status: 200, description: 'Business logo removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Business image removed')
  clearBusinessProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Query('businessId') queryBusinessId?: string,
  ) {
    return this.tenantService.clearBusinessProfileImage(
      admin,
      queryBusinessId,
    );
  }
}

