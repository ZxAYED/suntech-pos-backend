import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
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

  async list(
    admin: AccessTokenPayload,
    variantId: string,
    requestedBusinessId?: string,
  ): Promise<PresentedVariantImage[]> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
    return this.listImages(businessId, variantId);
  }

  async addImages(
    admin: AccessTokenPayload,
    variantId: string,
    files: UploadedImage[] | undefined,
    requestedBusinessId?: string,
  ): Promise<PresentedVariantImage[]> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
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
          key: image.publicId,
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
    requestedBusinessId?: string,
  ): Promise<{
    profileImageUrl: string;
    profileImagePublicId: string;
    profileImageKey: string;
    key: string;
  }> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
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
          profileImageKey: uploaded.publicId,
        },
      });

      if (updated.count === 0) {
        throw new NotFoundException('Variant not found');
      }
    } catch (error) {
      await this.cloudinary.deleteImage(uploaded.publicId);
      throw error;
    }

    await this.removeStoredImage(
      variant.profileImagePublicId || variant.profileImageKey,
    );
    return {
      profileImageUrl: uploaded.url,
      profileImagePublicId: uploaded.publicId,
      profileImageKey: uploaded.publicId,
      key: uploaded.publicId,
    };
  }

  async clearProfileImage(
    admin: AccessTokenPayload,
    variantId: string,
    requestedBusinessId?: string,
  ): Promise<{
    profileImageUrl: null;
    profileImagePublicId: null;
    profileImageKey: null;
    key: null;
  }> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
    const variant = await this.findVariant(businessId, variantId);
    const updated = await this.prisma.variant.updateMany({
      where: { id: variant.id, businessId, deletedAt: null },
      data: {
        profileImageUrl: null,
        profileImagePublicId: null,
        profileImageKey: null,
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Variant not found');
    }
    await this.removeStoredImage(
      variant.profileImagePublicId || variant.profileImageKey,
    );
    return {
      profileImageUrl: null,
      profileImagePublicId: null,
      profileImageKey: null,
      key: null,
    };
  }

  async removeImage(
    admin: AccessTokenPayload,
    variantId: string,
    imageId: string,
    requestedBusinessId?: string,
  ): Promise<PresentedVariantImage[]> {
    const businessId = await this.resolveBusinessId(admin, requestedBusinessId);
    await this.findVariant(businessId, variantId);
    const image = await this.prisma.variantImage.findFirst({
      where: {
        variantId,
        variant: { businessId, deletedAt: null },
        OR: [{ id: imageId }, { publicId: imageId }, { key: imageId }],
      },
      select: { id: true, publicId: true, key: true },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    await this.prisma.variantImage.delete({ where: { id: image.id } });

    await this.removeStoredImage(image.publicId || image.key);

    return this.listImages(businessId, variantId);
  }

  private async resolveBusinessId(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
  ): Promise<string> {
    if (actor.role === Role.CASHIER) {
      if (!actor.businessId) {
        throw new ForbiddenException('Business context is required');
      }
      return actor.businessId;
    }
    let businessId = requestedBusinessId?.trim() || actor.businessId;
    if (!businessId && actor.role === Role.ADMIN) {
      if (actor.businessIds && actor.businessIds.length === 1) {
        return actor.businessIds[0];
      }
      const user = await this.prisma.user.findFirst({
        where: { id: actor.sub, deletedAt: null },
        select: {
          businessId: true,
          ownedBusinesses: {
            where: { deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });
      businessId = user?.businessId || user?.ownedBusinesses?.[0]?.id;
    }
    if (!businessId) {
      throw new ForbiddenException('Create a business before continuing');
    }
    return businessId;
  }

  private async findVariant(businessId: string, variantId: string) {
    const variant = await this.prisma.variant.findFirst({
      where: { id: variantId, businessId, deletedAt: null },
      select: {
        id: true,
        profileImagePublicId: true,
        profileImageKey: true,
      },
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
