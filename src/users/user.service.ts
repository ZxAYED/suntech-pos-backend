import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Prisma, Role, ShiftStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { IdGeneratorService } from '../identity/id-generator.service';
import { CloudinaryService } from '../media/cloudinary.service';
import { UploadedImage } from '../media/uploaded-image';
import { PrismaService } from '../prisma/prisma.service';
import { Optional } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { ListCashiersQueryDto } from './dto/list-cashiers.query';
import { UpdateCashierDto } from './dto/update-cashier.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import {
  PresentedProfile,
  internalCashierEmail,
  presentEmail,
  presentProfile,
  userProfileSelect,
} from './user-profile.select';

const BCRYPT_ROUNDS = 10;

export type PresentedCashier = PresentedProfile & {
  location: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idGenerator: IdGeneratorService,
    private readonly cloudinary: CloudinaryService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async getMe(userId: string): Promise<PresentedProfile> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: userProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return presentProfile(user);
  }

  async listCashiers(
    admin: AccessTokenPayload,
    query: ListCashiersQueryDto,
  ): Promise<PresentedCashier[]> {
    const businessId = await this.requireBusinessId(admin, query.businessId);
    const cashiers = await this.prisma.user.findMany({
      where: {
        businessId,
        role: Role.CASHIER,
        deletedAt: null,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                {
                  fullName: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  publicId: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  phoneNumber: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        ...userProfileSelect,
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return cashiers.map((cashier) => ({
      ...cashier,
      email: presentEmail(cashier.email),
    }));
  }

  async createCashier(
    admin: AccessTokenPayload,
    dto: CreateCashierDto,
  ): Promise<PresentedProfile> {
    const businessId = await this.requireBusinessId(admin, dto.businessId);
    const location = await this.prisma.location.findFirst({
      where: {
        id: dto.locationId,
        businessId,
        deletedAt: null,
      },
    });

    if (!location) {
      const anyLocation = await this.prisma.location.findFirst({
        where: { id: dto.locationId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (
        anyLocation &&
        anyLocation.businessId &&
        anyLocation.businessId !== businessId
      ) {
        throw new BadRequestException(
          'Location does not belong to the specified business',
        );
      }
      throw new NotFoundException('Location not found');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const providedEmail = dto.email?.trim().toLowerCase();

    try {
      const cashier = await this.idGenerator.withZeroCollisionCashierId(
        (publicId) =>
          this.prisma.user.create({
            data: {
              fullName: dto.fullName.trim(),
              email: providedEmail || internalCashierEmail(publicId),
              phoneNumber: dto.phoneNumber?.trim() || null,
              password,
              publicId,
              role: Role.CASHIER,
              status: AccountStatus.ACTIVE,
              businessId,
              locationId: location.id,
              monthlySalary: dto.monthlySalary,
            },
            select: userProfileSelect,
          }),
      );

      return presentProfile(cashier);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'An account with that email or phone number already exists',
        );
      }

      throw error;
    }
  }

  async updateCashier(
    admin: AccessTokenPayload,
    cashierId: string,
    dto: UpdateCashierDto,
  ): Promise<PresentedCashier> {
    const businessId = await this.requireBusinessId(admin, dto.businessId);

    const cashier = await this.prisma.user.findFirst({
      where: {
        id: cashierId,
        businessId,
        role: Role.CASHIER,
        deletedAt: null,
      },
    });

    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }

    if (dto.locationId && dto.locationId !== cashier.locationId) {
      const location = await this.prisma.location.findFirst({
        where: {
          id: dto.locationId,
          businessId,
          deletedAt: null,
        },
      });

      if (!location) {
        const anyLocation = await this.prisma.location.findFirst({
          where: { id: dto.locationId, deletedAt: null },
          select: { id: true, businessId: true },
        });
        if (
          anyLocation &&
          anyLocation.businessId &&
          anyLocation.businessId !== businessId
        ) {
          throw new BadRequestException(
            'Location does not belong to the specified business',
          );
        }
        throw new NotFoundException('Location not found');
      }

      // Block branch reassignment while cashier has an active open shift
      if (this.prisma.shiftSession?.findFirst) {
        const activeShift = await this.prisma.shiftSession.findFirst({
          where: {
            cashierId,
            businessId,
            status: ShiftStatus.OPEN,
          },
        });

        if (activeShift) {
          throw new ConflictException(
            'Cannot reassign branch location while the cashier has an active open shift',
          );
        }
      }
    }

    const passwordHash =
      dto.password !== undefined
        ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
        : undefined;

    try {
      const updated = await this.prisma.user.update({
        where: { id: cashierId },
        data: {
          ...(dto.fullName !== undefined
            ? { fullName: dto.fullName.trim() }
            : {}),
          ...(dto.phoneNumber !== undefined
            ? { phoneNumber: dto.phoneNumber.trim() || null }
            : {}),
          ...(dto.locationId !== undefined
            ? { locationId: dto.locationId }
            : {}),
          ...(dto.monthlySalary !== undefined
            ? { monthlySalary: dto.monthlySalary }
            : {}),
          ...(passwordHash !== undefined
            ? {
                password: passwordHash,
                isLoggedIn: false,
                sessionId: null,
                lastLogoutAt: new Date(),
              }
            : {}),
        },
        select: {
          ...userProfileSelect,
          location: {
            select: {
              id: true,
              name: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      });

      if (dto.locationId && dto.locationId !== cashier.locationId) {
        await this.auditService?.log({
          actorId: admin.sub,
          businessId,
          action: 'BRANCH_REASSIGNMENT',
          entityType: 'USER',
          entityId: cashierId,
          metadata: {
            previousLocationId: cashier.locationId,
            newLocationId: dto.locationId,
          },
        });
      }

      if (dto.password !== undefined) {
        await this.auditService?.log({
          actorId: admin.sub,
          businessId,
          action: 'ADMIN_PASSWORD_RESET',
          entityType: 'USER',
          entityId: cashierId,
        });
      }

      if (
        dto.monthlySalary !== undefined &&
        dto.monthlySalary !== cashier.monthlySalary
      ) {
        await this.auditService?.log({
          actorId: admin.sub,
          businessId,
          action: 'SALARY_UPDATE',
          entityType: 'USER',
          entityId: cashierId,
          metadata: {
            previousSalary: cashier.monthlySalary,
            newSalary: dto.monthlySalary,
          },
        });
      }

      return {
        ...updated,
        email: presentEmail(updated.email),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'An account with that phone number already exists',
        );
      }

      throw error;
    }
  }

  async deleteCashier(
    admin: AccessTokenPayload,
    cashierId: string,
    requestedBusinessId?: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const businessId = await this.requireBusinessId(admin, requestedBusinessId);

    const cashier = await this.prisma.user.findFirst({
      where: {
        id: cashierId,
        businessId,
        role: Role.CASHIER,
        deletedAt: null,
      },
    });

    if (!cashier) {
      throw new NotFoundException('Cashier not found');
    }

    if (this.prisma.shiftSession?.findFirst) {
      const activeShift = await this.prisma.shiftSession.findFirst({
        where: {
          cashierId,
          businessId,
          status: ShiftStatus.OPEN,
        },
      });
      if (activeShift) {
        throw new ConflictException(
          'Cannot delete a cashier with an active open shift',
        );
      }
    }

    const timestamp = Date.now();
    const deletedAt = new Date();
    await this.prisma.user.update({
      where: { id: cashierId },
      data: {
        deletedAt,
        status: AccountStatus.SUSPENDED,
        email: `${cashier.email}__del_${timestamp}`,
        publicId: cashier.publicId
          ? `${cashier.publicId}__del_${timestamp}`
          : null,
        phoneNumber: cashier.phoneNumber
          ? `${cashier.phoneNumber}__del_${timestamp}`
          : null,
      },
    });

    return { id: cashierId, deletedAt };
  }

  async updateStatus(
    admin: AccessTokenPayload,
    userId: string,
    dto: UpdateUserStatusDto,
    requestedBusinessId?: string,
  ): Promise<PresentedProfile> {
    const businessId = await this.requireBusinessId(
      admin,
      requestedBusinessId || dto.businessId,
    );

    if (userId === admin.sub && dto.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException(
        'You cannot suspend or reject your own admin account',
      );
    }

    if (
      dto.status !== AccountStatus.ACTIVE &&
      this.prisma.shiftSession?.findFirst
    ) {
      const activeShift = await this.prisma.shiftSession.findFirst({
        where: {
          cashierId: userId,
          businessId,
          status: ShiftStatus.OPEN,
        },
      });

      if (activeShift) {
        throw new ConflictException(
          'Cannot suspend or deactivate a staff member with an active open shift',
        );
      }
    }

    const updated = await this.prisma.user.updateMany({
      where: {
        id: userId,
        businessId,
        deletedAt: null,
      },
      data: {
        status: dto.status,
        statusReason: dto.statusReason?.trim() || null,
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('User not found');
    }

    return this.getMe(userId);
  }

  setOwnProfileImage(
    userId: string,
    file: UploadedImage,
  ): Promise<PresentedProfile> {
    return this.replaceProfileImage({ id: userId }, file);
  }

  clearOwnProfileImage(userId: string): Promise<PresentedProfile> {
    return this.clearProfileImage({ id: userId });
  }

  async setStaffProfileImage(
    admin: AccessTokenPayload,
    userId: string,
    file: UploadedImage,
    requestedBusinessId?: string,
  ): Promise<PresentedProfile> {
    const businessId = await this.requireBusinessId(admin, requestedBusinessId);
    return this.replaceProfileImage({ id: userId, businessId }, file);
  }

  async clearStaffProfileImage(
    admin: AccessTokenPayload,
    userId: string,
    requestedBusinessId?: string,
  ): Promise<PresentedProfile> {
    const businessId = await this.requireBusinessId(admin, requestedBusinessId);
    return this.clearProfileImage({
      id: userId,
      businessId,
    });
  }

  private async replaceProfileImage(
    where: Prisma.UserWhereInput,
    file: UploadedImage,
  ): Promise<PresentedProfile> {
    const user = await this.prisma.user.findFirst({
      where: { ...where, deletedAt: null },
      select: {
        id: true,
        profileImagePublicId: true,
        profileImageKey: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const uploaded = await this.cloudinary.uploadImage(
      file,
      `suntech/users/${user.id}`,
    );

    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          profileImageUrl: uploaded.url,
          profileImagePublicId: uploaded.publicId,
          profileImageKey: uploaded.publicId,
        },
      });
    } catch (error) {
      await this.cloudinary.deleteImage(uploaded.publicId);
      throw error;
    }

    await this.removeStoredImage(
      user.profileImagePublicId || user.profileImageKey,
    );
    return this.getMe(user.id);
  }

  private async clearProfileImage(
    where: Prisma.UserWhereInput,
  ): Promise<PresentedProfile> {
    const user = await this.prisma.user.findFirst({
      where: { ...where, deletedAt: null },
      select: {
        id: true,
        profileImagePublicId: true,
        profileImageKey: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        profileImageUrl: null,
        profileImagePublicId: null,
        profileImageKey: null,
      },
    });
    await this.removeStoredImage(
      user.profileImagePublicId || user.profileImageKey,
    );
    return this.getMe(user.id);
  }

  private async removeStoredImage(publicId: string | null): Promise<void> {
    try {
      await this.cloudinary.deleteImage(publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not delete stored image: ${message}`);
    }
  }

  private async requireBusinessId(
    admin: AccessTokenPayload,
    requestedBusinessId?: string,
  ): Promise<string> {
    const businessId = requestedBusinessId?.trim() || admin.businessId;

    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }

    if (admin.role === Role.ADMIN) {
      const ownedBusinessIds = new Set(admin.businessIds ?? []);
      if (admin.businessId) {
        ownedBusinessIds.add(admin.businessId);
      }
      if (!ownedBusinessIds.has(businessId)) {
        if (this.prisma.business?.findFirst) {
          const owned = await this.prisma.business.findFirst({
            where: { id: businessId, ownerId: admin.sub, deletedAt: null },
          });
          if (owned) {
            return businessId;
          }
        }
        throw new ForbiddenException('You do not have access to this business');
      }
    }

    return businessId;
  }
}
