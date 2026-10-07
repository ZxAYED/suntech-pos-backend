import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Business, Location } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/create-location.dto';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async createBusiness(
    admin: AccessTokenPayload,
    dto: CreateBusinessDto,
  ): Promise<{ business: Business; accessToken: string }> {
    try {
      const business = await this.prisma.$transaction(async (tx) => {
        const created = await tx.business.create({
          data: {
            name: dto.name.trim(),
            ownerId: admin.sub,
          },
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

  private requireBusinessId(admin: AccessTokenPayload): string {
    if (!admin.businessId) {
      throw new ForbiddenException('Create a business before adding locations');
    }

    return admin.businessId;
  }
}
