import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { IdGeneratorService } from '../identity/id-generator.service';
import { CloudinaryService } from '../media/cloudinary.service';
import { UploadedImage } from '../media/uploaded-image';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import {
  PresentedProfile,
  internalCashierEmail,
  presentProfile,
  userProfileSelect,
} from './user-profile.select';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idGenerator: IdGeneratorService,
    private readonly cloudinary: CloudinaryService,
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

  async createCashier(
    admin: AccessTokenPayload,
    dto: CreateCashierDto,
  ): Promise<PresentedProfile> {
    const businessId = this.requireBusinessId(admin);
    const location = await this.prisma.location.findFirst({
      where: {
        id: dto.locationId,
        businessId,
        deletedAt: null,
      },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const providedEmail = dto.email?.trim().toLowerCase();

    try {
      const cashier = await this.idGenerator.withUniquePublicId(
        'CSH',
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

  async updateStatus(
    admin: AccessTokenPayload,
    userId: string,
    dto: UpdateUserStatusDto,
  ): Promise<PresentedProfile> {
    const businessId = this.requireBusinessId(admin);
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

  setStaffProfileImage(
    admin: AccessTokenPayload,
    userId: string,
    file: UploadedImage,
  ): Promise<PresentedProfile> {
    return this.replaceProfileImage(
      { id: userId, businessId: this.requireBusinessId(admin) },
      file,
    );
  }

  clearStaffProfileImage(
    admin: AccessTokenPayload,
    userId: string,
  ): Promise<PresentedProfile> {
    return this.clearProfileImage({
      id: userId,
      businessId: this.requireBusinessId(admin),
    });
  }

  private async replaceProfileImage(
    where: Prisma.UserWhereInput,
    file: UploadedImage,
  ): Promise<PresentedProfile> {
    const user = await this.prisma.user.findFirst({
      where: { ...where, deletedAt: null },
      select: { id: true, profileImagePublicId: true },
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
        },
      });
    } catch (error) {
      await this.cloudinary.deleteImage(uploaded.publicId);
      throw error;
    }

    await this.removeStoredImage(user.profileImagePublicId);
    return this.getMe(user.id);
  }

  private async clearProfileImage(
    where: Prisma.UserWhereInput,
  ): Promise<PresentedProfile> {
    const user = await this.prisma.user.findFirst({
      where: { ...where, deletedAt: null },
      select: { id: true, profileImagePublicId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        profileImageUrl: null,
        profileImagePublicId: null,
      },
    });
    await this.removeStoredImage(user.profileImagePublicId);
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

  private requireBusinessId(admin: AccessTokenPayload): string {
    if (!admin.businessId) {
      throw new ForbiddenException('Create a business before managing staff');
    }

    return admin.businessId;
  }
}
