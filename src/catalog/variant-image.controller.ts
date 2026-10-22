import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
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
  ApiParam,
  ApiQuery,
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
    summary: '[ADMIN] Upload / update variant profile hero image',
    description:
      'Uploads new primary display image to Cloudinary, updates profileImageUrl and keys (profileImagePublicId / profileImageKey / key), and automatically deletes previous hero image from cloud storage. Requires ADMIN role.',
  })
  @ApiParam({ name: 'variantId', description: 'Variant ID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
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
    status: 200,
    description:
      'Variant image updated; returns profileImageUrl and key (profileImagePublicId / profileImageKey / key)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ResponseMessage('Variant image updated')
  setProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @UploadedFile() file: UploadedImage,
    @Query('businessId') businessId?: string,
  ) {
    return this.variantImages.setProfileImage(admin, variantId, file, businessId);
  }

  @Delete(':variantId/profile-image')
  @ApiOperation({
    summary: '[ADMIN] Remove variant profile hero image',
    description:
      'Deletes primary display image from Cloudinary and clears profileImageUrl and key fields for the variant. Requires ADMIN role.',
  })
  @ApiParam({ name: 'variantId', description: 'Variant ID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant image removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ResponseMessage('Variant image removed')
  clearProfileImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.variantImages.clearProfileImage(admin, variantId, businessId);
  }

  @Get(':variantId/images')
  @ApiOperation({
    summary: '[ADMIN] List variant gallery images',
    description:
      'Returns gallery image records associated with variant. Requires ADMIN role.',
  })
  @ApiParam({ name: 'variantId', description: 'Variant ID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant images loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ResponseMessage('Variant images loaded')
  list(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.variantImages.list(admin, variantId, businessId);
  }

  @Post(':variantId/images')
  @ApiOperation({
    summary: '[ADMIN] Upload multiple gallery images for variant',
    description:
      'Uploads up to MAX_VARIANT_IMAGES to the variant gallery. Requires ADMIN role.',
  })
  @ApiParam({ name: 'variantId', description: 'Variant ID' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
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
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @UseInterceptors(
    FilesInterceptor('images', MAX_VARIANT_IMAGES, imageUploadOptions),
  )
  @ResponseMessage('Variant images uploaded')
  addImages(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @UploadedFiles() files: UploadedImage[],
    @Query('businessId') businessId?: string,
  ) {
    return this.variantImages.addImages(admin, variantId, files, businessId);
  }

  @Delete(':variantId/images/:imageId')
  @ApiOperation({
    summary: '[ADMIN] Remove variant gallery image by image ID or key',
    description:
      'Deletes image from media storage and detaches from variant. Accepts image ID or storage publicId/key. Requires ADMIN role.',
  })
  @ApiParam({ name: 'variantId', description: 'Variant ID' })
  @ApiParam({ name: 'imageId', description: 'Image ID or storage key/publicId' })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description: 'Optional business UUID for Admin to target a specific business',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Variant image removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Image or variant not found' })
  @ResponseMessage('Variant image removed')
  removeImage(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('variantId') variantId: string,
    @Param('imageId') imageId: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.variantImages.removeImage(admin, variantId, imageId, businessId);
  }
}
