import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
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
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { TenantService } from './tenant.service';

@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('business')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Business created')
  createBusiness(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateBusinessDto,
  ) {
    return this.tenantService.createBusiness(admin, dto);
  }

  @Post('locations')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Location created')
  createLocation(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: CreateLocationDto,
  ) {
    return this.tenantService.createLocation(admin, dto);
  }

  @Post('business/profile-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Business image updated')
  setBusinessProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.tenantService.setBusinessProfileImage(admin, file);
  }

  @Delete('business/profile-image')
  @ResponseMessage('Business image removed')
  clearBusinessProfileImage(@CurrentUser() admin: AccessTokenPayload) {
    return this.tenantService.clearBusinessProfileImage(admin);
  }
}
