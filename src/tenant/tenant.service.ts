import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Location, Prisma, Role, ShiftStatus } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { AuthService } from '../auth/auth.service';
import { CloudinaryService } from '../media/cloudinary.service';
import { UploadedImage } from '../media/uploaded-image';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

const businessSelect = {
  id: true,
  name: true,
  ownerId: true,
  profileImageUrl: true,
  profileImagePublicId: true,
  profileImageKey: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessSelect;

export type PresentedBusiness = Prisma.BusinessGetPayload<{
  select: typeof businessSelect;
}>;

export interface BusinessWithLocations extends PresentedBusiness {
  locations: {
    id: string;
    name: string;
    address: string | null;
    businessId: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async listBusinesses(
    admin: AccessTokenPayload,
  ): Promise<BusinessWithLocations[]> {
    return this.prisma.business.findMany({
      where: {
        ownerId: admin.sub,
        deletedAt: null,
      },
      select: {
        ...businessSelect,
        locations: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            address: true,
            businessId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

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

  async getBusinessProfile(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
  ): Promise<PresentedBusiness> {
    if (actor.role === Role.CASHIER) {
      if (!actor.businessId) {
        throw new ForbiddenException('Business context is required');
      }
      return this.getBusiness(actor.businessId);
    }

    const businessId = await this.resolveAdminBusinessId(
      actor,
      requestedBusinessId,
      false,
    );
    if (!businessId) {
      throw new NotFoundException('Business not found');
    }

    return this.getBusiness(businessId);
  }

  async getLocations(
    actor: AccessTokenPayload,
    requestedBusinessId?: string,
    locationId?: string,
    search?: string,
  ): Promise<Location[]> {
    let businessId: string;

    if (actor.role === Role.CASHIER) {
      if (!actor.businessId) {
        throw new ForbiddenException('Business context is required');
      }
      if (!actor.locationId) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }
      businessId = actor.businessId;
      locationId = actor.locationId;
    } else {
      const resolved = await this.resolveAdminBusinessId(
        actor,
        requestedBusinessId,
        false,
      );
      if (!resolved) {
        return [];
      }
      businessId = resolved;
    }

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
    const trimmedName = dto.name.trim();

    const existing = await this.prisma.business.findFirst({
      where: {
        ownerId: admin.sub,
        name: { equals: trimmedName, mode: 'insensitive' },
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictException('You already have a business with this name');
    }

    let created: PresentedBusiness;
    try {
      created = await this.prisma.business.create({
        data: {
          name: trimmedName,
          ownerId: admin.sub,
        },
        select: businessSelect,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'You already have a business with this name',
        );
      }
      throw error;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: admin.sub },
      data: { businessId: created.id },
    });

    const accessToken = await this.authService.signAccessToken(updatedUser);

    return {
      business: created,
      accessToken,
    };
  }

  async selectBusiness(
    admin: AccessTokenPayload,
    businessId: string,
  ): Promise<{ business: PresentedBusiness; accessToken: string }> {
    const targetId = businessId?.trim();
    if (!targetId) {
      throw new BadRequestException('Business ID is required');
    }

    const business = await this.prisma.business.findFirst({
      where: {
        id: targetId,
        deletedAt: null,
      },
      select: businessSelect,
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    if (business.ownerId !== admin.sub) {
      throw new ForbiddenException('You do not own this business');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: admin.sub },
      data: { businessId: business.id },
    });

    const accessToken = await this.authService.signAccessToken(updatedUser);

    return {
      business,
      accessToken,
    };
  }

  async updateBusiness(
    admin: AccessTokenPayload,
    businessId: string,
    dto: UpdateBusinessDto,
  ): Promise<PresentedBusiness> {
    const business = await this.prisma.business.findFirst({
      where: {
        id: businessId,
        ownerId: admin.sub,
        deletedAt: null,
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found or access denied');
    }

    if (dto.name !== undefined) {
      const trimmedName = dto.name.trim();
      const duplicate = await this.prisma.business.findFirst({
        where: {
          ownerId: admin.sub,
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: businessId },
          deletedAt: null,
        },
      });

      if (duplicate) {
        throw new ConflictException(
          'You already have a business with this name',
        );
      }
    }

    return this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      },
      select: businessSelect,
    });
  }

  async deleteBusiness(
    admin: AccessTokenPayload,
    businessId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const business = await this.prisma.business.findFirst({
      where: {
        id: businessId,
        ownerId: admin.sub,
        deletedAt: null,
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found or access denied');
    }

    const branchCount = await this.prisma.location.count({
      where: {
        businessId,
        deletedAt: null,
      },
    });

    if (branchCount > 0) {
      throw new ConflictException(
        'Cannot delete business with existing branch locations. Please delete all branches first.',
      );
    }

    if (this.prisma.shiftSession?.findFirst) {
      const activeShift = await this.prisma.shiftSession.findFirst({
        where: { businessId, status: ShiftStatus.OPEN },
      });
      if (activeShift) {
        throw new ConflictException(
          'Cannot delete a business with active open shifts in its branches',
        );
      }
    }

    const deletedAt = new Date();
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        deletedAt,
        name: `${business.name}__del_${Date.now()}`,
      },
    });

    if (admin.businessId === businessId) {
      const nextBusiness = await this.prisma.business.findFirst({
        where: { ownerId: admin.sub, id: { not: businessId }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      await this.prisma.user.update({
        where: { id: admin.sub },
        data: { businessId: nextBusiness?.id || null },
      });
    }

    return { id: businessId, deletedAt };
  }

  async createLocation(
    admin: AccessTokenPayload,
    dto: CreateLocationDto,
  ): Promise<Location> {
    const businessId = await this.resolveAdminBusinessId(
      admin,
      dto.businessId,
      true,
    );

    const trimmedName = dto.name.trim();
    const trimmedAddress = dto.address?.trim() || null;

    const existing = await this.prisma.location.findFirst({
      where: {
        businessId,
        name: { equals: trimmedName, mode: 'insensitive' },
        address: trimmedAddress
          ? { equals: trimmedAddress, mode: 'insensitive' }
          : null,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictException(
        'A branch location with that name and address already exists in this business',
      );
    }

    try {
      return await this.prisma.location.create({
        data: {
          name: trimmedName,
          address: trimmedAddress,
          businessId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A branch location with that name and address already exists in this business',
        );
      }
      throw error;
    }
  }

  async updateLocation(
    admin: AccessTokenPayload,
    locationId: string,
    dto: UpdateLocationDto,
  ): Promise<Location> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, deletedAt: null },
      include: { business: { select: { ownerId: true } } },
    });

    if (!location || location.business.ownerId !== admin.sub) {
      throw new NotFoundException('Location not found');
    }

    const targetName = dto.name !== undefined ? dto.name.trim() : location.name;
    const targetAddress =
      dto.address !== undefined ? dto.address.trim() || null : location.address;

    if (dto.name !== undefined || dto.address !== undefined) {
      const duplicate = await this.prisma.location.findFirst({
        where: {
          businessId: location.businessId,
          name: { equals: targetName, mode: 'insensitive' },
          address: targetAddress
            ? { equals: targetAddress, mode: 'insensitive' }
            : null,
          id: { not: locationId },
          deletedAt: null,
        },
      });

      if (duplicate) {
        throw new ConflictException(
          'A branch location with that name and address already exists in this business',
        );
      }
    }

    try {
      return await this.prisma.location.update({
        where: { id: locationId },
        data: {
          ...(dto.name !== undefined ? { name: targetName } : {}),
          ...(dto.address !== undefined ? { address: targetAddress } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A branch location with that name and address already exists in this business',
        );
      }
      throw error;
    }
  }

  async deleteLocation(
    admin: AccessTokenPayload,
    locationId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, deletedAt: null },
      include: { business: { select: { ownerId: true } } },
    });

    if (!location || location.business.ownerId !== admin.sub) {
      throw new NotFoundException('Location not found');
    }

    if (this.prisma.shiftSession?.findFirst) {
      const activeShift = await this.prisma.shiftSession.findFirst({
        where: { locationId, status: ShiftStatus.OPEN },
      });
      if (activeShift) {
        throw new ConflictException(
          'Cannot delete a location with an active open shift',
        );
      }
    }

    if (this.prisma.user?.findFirst) {
      const activeCashier = await this.prisma.user.findFirst({
        where: { locationId, role: Role.CASHIER, deletedAt: null },
      });
      if (activeCashier) {
        throw new ConflictException(
          'Cannot delete a location with active assigned cashiers. Reassign or delete cashiers first.',
        );
      }
    }

    const deletedAt = new Date();
    await this.prisma.location.update({
      where: { id: locationId },
      data: {
        deletedAt,
        name: `${location.name}__del_${Date.now()}`,
      },
    });

    return { id: locationId, deletedAt };
  }

  async setBusinessProfileImage(
    admin: AccessTokenPayload,
    file: UploadedImage,
    targetBusinessId?: string,
  ): Promise<PresentedBusiness> {
    const businessId = await this.resolveAdminBusinessId(
      admin,
      targetBusinessId,
      true,
    );
    const business = await this.findOwnedBusiness(businessId, admin.sub);
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
          profileImageKey: uploaded.publicId,
        },
        select: businessSelect,
      });
      await this.removeStoredImage(
        business.profileImagePublicId || business.profileImageKey,
      );
      return updated;
    } catch (error) {
      await this.cloudinary.deleteImage(uploaded.publicId);
      throw error;
    }
  }

  async clearBusinessProfileImage(
    admin: AccessTokenPayload,
    targetBusinessId?: string,
  ): Promise<PresentedBusiness> {
    const businessId = await this.resolveAdminBusinessId(
      admin,
      targetBusinessId,
      true,
    );
    const business = await this.findOwnedBusiness(businessId, admin.sub);
    const updated = await this.prisma.business.update({
      where: { id: business.id },
      data: {
        profileImageUrl: null,
        profileImagePublicId: null,
        profileImageKey: null,
      },
      select: businessSelect,
    });
    await this.removeStoredImage(
      business.profileImagePublicId || business.profileImageKey,
    );
    return updated;
  }

  private async findOwnedBusiness(businessId: string, ownerId: string) {
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, ownerId, deletedAt: null },
      select: {
        id: true,
        profileImagePublicId: true,
        profileImageKey: true,
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found or access denied');
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

  private async resolveAdminBusinessId(
    admin: AccessTokenPayload,
    requestedBusinessId?: string,
    required = true,
  ): Promise<string> {
    const targetId = requestedBusinessId?.trim() || admin.businessId;
    if (targetId) {
      const owned = await this.prisma.business.findFirst({
        where: { id: targetId, ownerId: admin.sub, deletedAt: null },
        select: { id: true },
      });
      if (!owned) {
        throw new ForbiddenException('You do not own this business');
      }
      return owned.id;
    }

    const firstOwned = await this.prisma.business.findFirst({
      where: { ownerId: admin.sub, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!firstOwned && required) {
      throw new ForbiddenException(
        'Create a business before managing branches',
      );
    }

    return firstOwned?.id || '';
  }
}
