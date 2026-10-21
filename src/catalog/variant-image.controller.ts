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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

@ApiTags('Catalog - Variant Images')
@ApiBearerAuth()
@Controller('variants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class VariantImageController {
  constructor(private readonly variantImages: VariantImageService) {}

  @Post(':variantId/profile-image')
  @ApiOperation({
    summary: 'Upload / update variant profile hero image',
    description: 'Uploads and links primary display image for the variant.',
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
  @ApiResponse({ status: 200, description: 'Variant image updated' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
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
  @ApiOperation({
    summary: 'Remove variant profile hero image',
    description: 'Clears primary display image for the variant.',
  })
  @ApiResponse({ status: 200, description: 'Variant image removed' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ResponseMessage('Variant image removed')
  clearProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
  ) {
    return this.variantImages.clearProfileImage(admin, variantId);
  }

  @Get(':variantId/images')
  @ApiOperation({
    summary: 'List variant gallery images',
    description: 'Returns gallery image records associated with variant.',
  })
  @ApiResponse({ status: 200, description: 'Variant images loaded' })
  @ResponseMessage('Variant images loaded')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
  ) {
    return this.variantImages.list(admin, variantId);
  }

  @Post(':variantId/images')
  @ApiOperation({
    summary: 'Upload multiple gallery images for variant',
    description: 'Uploads up to MAX_VARIANT_IMAGES to the variant gallery.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Variant images uploaded' })
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
  @ApiOperation({
    summary: 'Remove variant gallery image by image ID',
    description: 'Deletes image from media storage and detaches from variant.',
  })
  @ApiResponse({ status: 200, description: 'Variant image removed' })
  @ApiResponse({ status: 404, description: 'Image or variant not found' })
  @ResponseMessage('Variant image removed')
  removeImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.variantImages.removeImage(admin, variantId, imageId);
  }
}
