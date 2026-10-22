import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import {
  PublicUser,
  userPublicSelect,
} from '../common/prisma/user-public.select';
import { IdGeneratorService } from '../identity/id-generator.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query';

export interface AdminListItem {
  id: string;
  publicId: string | null;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  role: Role;
  status: AccountStatus;
  statusReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  business: {
    id: string;
    name: string;
    _count: {
      locations: number;
    };
  } | null;
}

export interface AdminListResponse {
  items: AdminListItem[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idGenerator: IdGeneratorService,
  ) {}

  async list(query: ListAdminUsersQueryDto): Promise<AdminListResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const where: Prisma.UserWhereInput = {
      role: Role.ADMIN,
      deletedAt: null,
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
              { email: { contains: query.search.trim(), mode: 'insensitive' } },
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
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          publicId: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          role: true,
          status: true,
          statusReason: true,
          createdAt: true,
          updatedAt: true,
          ownedBusinesses: {
            where: { deletedAt: null },
            select: {
              id: true,
              name: true,
              _count: {
                select: {
                  locations: {
                    where: { deletedAt: null },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items: AdminListItem[] = users.map((u) => ({
      id: u.id,
      publicId: u.publicId,
      fullName: u.fullName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role,
      status: u.status,
      statusReason: u.statusReason,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      business: u.ownedBusinesses?.[0]
        ? {
            id: u.ownedBusinesses[0].id,
            name: u.ownedBusinesses[0].name,
            _count: u.ownedBusinesses[0]._count,
          }
        : null,
    }));

    return {
      items,
      page,
      limit,
      total,
    };
  }

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

  async updateStatus(
    userId: string,
    dto: UpdateUserStatusDto,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('Admin user not found');
    }

    if (user.role !== Role.ADMIN) {
      throw new BadRequestException('Only admin accounts can be managed');
    }

    if (!user.publicId && dto.status === AccountStatus.ACTIVE) {
      await this.idGenerator.assignUniquePublicId(user.id);
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: dto.status,
        statusReason: dto.statusReason?.trim() || null,
      },
      select: userPublicSelect,
    });
  }
}
