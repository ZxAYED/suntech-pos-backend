import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import {
  PublicUser,
  userPublicSelect,
} from '../common/prisma/user-public.select';
import { IdGeneratorService } from '../identity/id-generator.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idGenerator: IdGeneratorService,
  ) {}

  async approve(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== Role.ADMIN) {
      throw new BadRequestException(
        'Only business admin accounts can be approved',
      );
    }

    if (user.status !== AccountStatus.PENDING_APPROVAL) {
      throw new ConflictException('User is not awaiting approval');
    }

    const publicId = await this.idGenerator.assignUniquePublicId(user.id);

    if (!publicId) {
      throw new ConflictException('User is not awaiting approval');
    }

    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: userPublicSelect,
    });
  }
}
