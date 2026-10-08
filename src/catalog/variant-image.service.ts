import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { CloudinaryService } from '../media/cloudinary.service';
import {
  MAX_VARIANT_IMAGES,
  UploadedImage,
  assertImageFile,
} from '../media/uploaded-image';
import { PrismaService } from '../prisma/prisma.service';
import {
  PresentedVariantImage,
  variantImageSelect,
} from './variant-image.select';

const MAX_IMAGES_PER_VARIANT = 10;

@Injectable()
export class VariantImageService {
  private readonly logger = new Logger(VariantImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  list(
    admin: AccessTokenPayload,
    variantId: string,
  ): Promise<PresentedVariantImage[]> {
    return this.listImages(this.requireBusinessId(admin), variantId);
  }

  async addImages(
    admin: AccessTokenPayload,
    variantId: string,
    files: UploadedImage[] | undefined,
  ): Promise<PresentedVariantImage[]> {
    const businessId = this.requireBusinessId(admin);
    const images = files ?? [];

    if (images.length === 0) {
      throw new BadRequestException('At least one image is required');
    }

    if (images.length > MAX_VARIANT_IMAGES) {
      throw new BadRequestException(
        `Upload at most ${MAX_VARIANT_IMAGES} images at a time`,
      );
    }

    images.forEach((file) => assertImageFile(file));

    const variant = await this.prisma.variant.findFirst({
      where: { id: variantId, businessId, deletedAt: null },
      select: {
        id: true,
        _count: { select: { images: true } },
      },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    if (variant._count.images + images.length > MAX_IMAGES_PER_VARIANT) {
      throw new BadRequestException(
        `A variant can have at most ${MAX_IMAGES_PER_VARIANT} images`,
      );
    }

    const uploaded = await this.cloudinary.uploadImages(
      images,
      `suntech/variants/${variant.id}`,
    );
    const sortStart = variant._count.images;

    try {
      await this.prisma.variantImage.createMany({
        data: uploaded.map((image, index) => ({
          variantId: variant.id,
          url: image.url,
          publicId: image.publicId,
          sortOrder: sortStart + index,
        })),
      });
    } catch (error) {
      await this.cloudinary.deleteImages(
        uploaded.map((image) => image.publicId),
      );
      throw error;
    }

    return this.listImages(businessId, variant.id);
  }

  async setProfileImage(
    admin: AccessTokenPayload,
    variantId: string,
    file: UploadedImage,
  ): Promise<{ profileImageUrl: string }> {
    const businessId = this.requireBusinessId(admin);
    const variant = await this.findVariant(businessId, variantId);
    const uploaded = await this.cloudinary.uploadImage(
      file,
      `suntech/variants/${variant.id}/profile`,
    );

    try {
      const updated = await this.prisma.variant.updateMany({
        where: { id: variant.id, businessId, deletedAt: null },
        data: {
          profileImageUrl: uploaded.url,
          profileImagePublicId: uploaded.publicId,
        },
      });

      if (updated.count === 0) {
        throw new NotFoundException('Variant not found');
      }
    } catch (error) {
      await this.cloudinary.deleteImage(uploaded.publicId);
      throw error;
    }

    await this.removeStoredImage(variant.profileImagePublicId);
    return { profileImageUrl: uploaded.url };
  }

  async clearProfileImage(
    admin: AccessTokenPayload,
    variantId: string,
  ): Promise<{ profileImageUrl: null }> {
    const businessId = this.requireBusinessId(admin);
    const variant = await this.findVariant(businessId, variantId);
    const updated = await this.prisma.variant.updateMany({
      where: { id: variant.id, businessId, deletedAt: null },
      data: {
        profileImageUrl: null,
        profileImagePublicId: null,
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Variant not found');
    }
    await this.removeStoredImage(variant.profileImagePublicId);
    return { profileImageUrl: null };
  }

  async removeImage(
    admin: AccessTokenPayload,
    variantId: string,
    imageId: string,
  ): Promise<PresentedVariantImage[]> {
    const businessId = this.requireBusinessId(admin);
    await this.findVariant(businessId, variantId);
    const image = await this.prisma.variantImage.findFirst({
      where: {
        id: imageId,
        variantId,
        variant: { businessId, deletedAt: null },
      },
      select: { id: true, publicId: true },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    await this.prisma.variantImage.delete({ where: { id: image.id } });

    try {
      await this.cloudinary.deleteImage(image.publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not delete stored image: ${message}`);
    }

    return this.listImages(businessId, variantId);
  }

  private requireBusinessId(admin: AccessTokenPayload): string {
    if (!admin.businessId) {
      throw new ForbiddenException(
        'Create a business before managing products',
      );
    }

    return admin.businessId;
  }

  private async findVariant(businessId: string, variantId: string) {
    const variant = await this.prisma.variant.findFirst({
      where: { id: variantId, businessId, deletedAt: null },
      select: { id: true, profileImagePublicId: true },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    return variant;
  }

  private async removeStoredImage(publicId: string | null): Promise<void> {
    try {
      await this.cloudinary.deleteImage(publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not delete stored image: ${message}`);
    }
  }

  private async listImages(
    businessId: string,
    variantId: string,
  ): Promise<PresentedVariantImage[]> {
    await this.findVariant(businessId, variantId);

    return this.prisma.variantImage.findMany({
      where: { variantId },
      select: variantImageSelect,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
