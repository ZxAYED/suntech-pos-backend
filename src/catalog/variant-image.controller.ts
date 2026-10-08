import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  MAX_VARIANT_IMAGES,
  imageUploadOptions,
  type UploadedImage,
} from '../media/uploaded-image';
import { VariantImageService } from './variant-image.service';

@Controller('variants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class VariantImageController {
  constructor(private readonly variantImages: VariantImageService) {}

  @Post(':variantId/profile-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Variant image updated')
  setProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.variantImages.setProfileImage(admin, variantId, file);
  }

  @Delete(':variantId/profile-image')
  @ResponseMessage('Variant image removed')
  clearProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
  ) {
    return this.variantImages.clearProfileImage(admin, variantId);
  }

  @Get(':variantId/images')
  @ResponseMessage('Variant images loaded')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
  ) {
    return this.variantImages.list(admin, variantId);
  }

  @Post(':variantId/images')
  @UseInterceptors(
    FilesInterceptor('images', MAX_VARIANT_IMAGES, imageUploadOptions),
  )
  @ResponseMessage('Variant images uploaded')
  addImages(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.variantImages.addImages(admin, variantId, files);
  }

  @Delete(':variantId/images/:imageId')
  @ResponseMessage('Variant image removed')
  removeImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.variantImages.removeImage(admin, variantId, imageId);
  }
}
