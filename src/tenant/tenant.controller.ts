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

@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('business')
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
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Business profile loaded')
  getBusiness(@CurrentUser() actor: AccessTokenPayload) {
    const scope = resolveLocationScope(actor);
    return this.tenantService.getBusiness(scope.businessId);
  }

  @Post('locations')
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
  @Roles(Role.ADMIN)
  @ResponseMessage('Location deleted')
  deleteLocation(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.tenantService.deleteLocation(admin, id);
  }

  @Post('business/profile-image')
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
  @Roles(Role.ADMIN)
  @ResponseMessage('Business image removed')
  clearBusinessProfileImage(@CurrentUser() admin: AccessTokenPayload) {
    return this.tenantService.clearBusinessProfileImage(admin);
  }
}
