import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Location, Prisma } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { AuthService } from '../auth/auth.service';
import { CloudinaryService } from '../media/cloudinary.service';
import { UploadedImage } from '../media/uploaded-image';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const businessSelect = {
  id: true,
  name: true,
  ownerId: true,
  profileImageUrl: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessSelect;

export type PresentedBusiness = Prisma.BusinessGetPayload<{
  select: typeof businessSelect;
}>;

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getBusiness(businessId: string): Promise<PresentedBusiness> {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: businessSelect,
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return business;
  }

  async getLocations(
    businessId: string,
    locationId?: string,
    search?: string,
  ): Promise<Location[]> {
    return this.prisma.location.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(locationId ? { id: locationId } : {}),
        ...(search?.trim()
          ? {
              OR: [
                {
                  name: { contains: search.trim(), mode: 'insensitive' },
                },
                {
                  address: {
                    contains: search.trim(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createBusiness(
    admin: AccessTokenPayload,
    dto: CreateBusinessDto,
  ): Promise<{ business: PresentedBusiness; accessToken: string }> {
    try {
      const business = await this.prisma.$transaction(async (tx) => {
        const created = await tx.business.create({
          data: {
            name: dto.name.trim(),
            ownerId: admin.sub,
          },
          select: businessSelect,
        });

        await tx.user.update({
          where: { id: admin.sub },
          data: { businessId: created.id },
        });

        return created;
      });

      const owner = await this.prisma.user.findUniqueOrThrow({
        where: { id: admin.sub },
      });
      const accessToken = await this.authService.signAccessToken(owner);

      return { business, accessToken };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('You already have a business');
      }

      throw error;
    }
  }

  async createLocation(
    admin: AccessTokenPayload,
    dto: CreateLocationDto,
  ): Promise<Location> {
    const businessId = this.requireBusinessId(admin);

    return this.prisma.location.create({
      data: {
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        businessId,
      },
    });
  }

  async updateLocation(
    admin: AccessTokenPayload,
    locationId: string,
    dto: UpdateLocationDto,
  ): Promise<Location> {
    const businessId = this.requireBusinessId(admin);

    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId, deletedAt: null },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return this.prisma.location.update({
      where: { id: locationId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.address !== undefined
          ? { address: dto.address.trim() || null }
          : {}),
      },
    });
  }

  async deleteLocation(
    admin: AccessTokenPayload,
    locationId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = this.requireBusinessId(admin);
    const deletedAt = new Date();

    const result = await this.prisma.location.updateMany({
      where: { id: locationId, businessId, deletedAt: null },
      data: { deletedAt },
    });

    if (result.count === 0) {
      throw new NotFoundException('Location not found');
    }

    return { id: locationId, deletedAt };
  }

  async setBusinessProfileImage(
    admin: AccessTokenPayload,
    file: UploadedImage,
  ): Promise<PresentedBusiness> {
    const businessId = this.requireBusinessId(
      admin,
      'Create a business before uploading an image',
    );
    const business = await this.findOwnedBusiness(businessId);
    const uploaded = await this.cloudinary.uploadImage(
      file,
      `suntech/businesses/${business.id}`,
    );

    try {
      const updated = await this.prisma.business.update({
        where: { id: business.id },
        data: {
          profileImageUrl: uploaded.url,
          profileImagePublicId: uploaded.publicId,
        },
        select: businessSelect,
      });
      await this.removeStoredImage(business.profileImagePublicId);
      return updated;
    } catch (error) {
      await this.cloudinary.deleteImage(uploaded.publicId);
      throw error;
    }
  }

  async clearBusinessProfileImage(
    admin: AccessTokenPayload,
  ): Promise<PresentedBusiness> {
    const business = await this.findOwnedBusiness(
      this.requireBusinessId(
        admin,
        'Create a business before uploading an image',
      ),
    );
    const updated = await this.prisma.business.update({
      where: { id: business.id },
      data: {
        profileImageUrl: null,
        profileImagePublicId: null,
      },
      select: businessSelect,
    });
    await this.removeStoredImage(business.profileImagePublicId);
    return updated;
  }

  private async findOwnedBusiness(businessId: string) {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { id: true, profileImagePublicId: true },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return business;
  }

  private async removeStoredImage(publicId: string | null): Promise<void> {
    try {
      await this.cloudinary.deleteImage(publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not delete stored image: ${message}`);
    }
  }

  private requireBusinessId(
    admin: AccessTokenPayload,
    message = 'Create a business before adding locations',
  ): string {
    if (!admin.businessId) {
      throw new ForbiddenException(message);
    }

    return admin.businessId;
  }
}
