import {
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
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { resolveLocationScope } from '../common/utils/location-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  imageUploadOptions,
  type UploadedImage,
} from '../media/uploaded-image';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { TenantService } from './tenant.service';

@ApiTags('Tenancy & Locations')
@ApiBearerAuth()
@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('business')
  @ApiOperation({
    summary: 'Create business tenant profile',
    description: 'Initializes business profile for authenticated store admin.',
  })
  @ApiResponse({
    status: 201,
    description: 'Business created, new JWT token returned',
  })
  @ApiResponse({
    status: 409,
    description: 'User already has a business registered',
  })
  @Roles(Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Business created')
  createBusiness(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateBusinessDto,
  ) {
    return this.tenantService.createBusiness(admin, dto);
  }

  @Get('business')
  @ApiOperation({
    summary: 'Get business tenant profile',
    description: 'Returns business profile details for the active business.',
  })
  @ApiResponse({ status: 200, description: 'Business profile returned' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Business profile loaded')
  getBusiness(@CurrentUser() actor: AccessTokenPayload) {
    const scope = resolveLocationScope(actor);
    return this.tenantService.getBusiness(scope.businessId);
  }

  @Post('locations')
  @ApiOperation({
    summary: 'Create branch location',
    description:
      'Creates a new branch location scoped to the business (tenant-scoped unique name).',
  })
  @ApiResponse({ status: 201, description: 'Location created' })
  @ApiResponse({
    status: 409,
    description: 'Location with that name already exists in your business',
  })
  @Roles(Role.ADMIN)
  @Idempotent()
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
    summary: 'List store branch locations',
    description:
      'Returns locations for the business. Cashiers are scoped to their assigned branch.',
  })
  @ApiResponse({ status: 200, description: 'Locations list returned' })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Locations loaded')
  getLocations(
    @CurrentUser() actor: AccessTokenPayload,
    @Query('locationId') locationId?: string,
    @Query('search') search?: string,
  ) {
    const scope = resolveLocationScope(actor, locationId);
    return this.tenantService.getLocations(
      scope.businessId,
      scope.locationId,
      search,
    );
  }

  @Patch('locations/:id')
  @ApiOperation({
    summary: 'Update branch location',
    description:
      'Updates location name or address with tenant uniqueness checks.',
  })
  @ApiResponse({ status: 200, description: 'Location updated' })
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
    summary: 'Delete branch location',
    description:
      'Soft-deletes location if no open shifts exist at that location.',
  })
  @ApiResponse({ status: 200, description: 'Location deleted' })
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
    summary: 'Upload business logo/image',
    description: 'Uploads and links business logo to Cloudinary.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Business logo uploaded' })
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Business image updated')
  setBusinessProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.tenantService.setBusinessProfileImage(admin, file);
  }

  @Delete('business/profile-image')
  @ApiOperation({
    summary: 'Remove business logo/image',
    description: 'Deletes business logo from Cloudinary.',
  })
  @ApiResponse({ status: 200, description: 'Business logo removed' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Business image removed')
  clearBusinessProfileImage(@CurrentUser() admin: AccessTokenPayload) {
    return this.tenantService.clearBusinessProfileImage(admin);
  }
}
