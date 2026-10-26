import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import { AccessTokenPayload } from '../types/access-token-payload';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query';

@Injectable()
export class AuditReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async business(
    actor: AccessTokenPayload,
    requested?: string,
  ): Promise<string> {
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Audit logs require Admin access');
    const businessId = requested?.trim();
    if (!businessId)
      throw new BadRequestException('businessId is required for audit logs');
    const owned = await this.prisma.business.findFirst({
      where: { id: businessId, ownerId: actor.sub, deletedAt: null },
      select: { id: true },
    });
    if (!owned)
      throw new ForbiddenException('You do not have access to this business');
    return owned.id;
  }

  private async where(
    actor: AccessTokenPayload,
    query: ListAuditLogsQueryDto,
  ): Promise<Prisma.AuditLogWhereInput> {
    const businessId = await this.business(actor, query.businessId);
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException('from must be before or equal to to');
    if (query.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: query.locationId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!location)
        throw new ForbiddenException(
          'Location does not belong to the selected business',
        );
    }
    return {
      businessId,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }

  async list(actor: AccessTokenPayload, query: ListAuditLogsQueryDto) {
    const where = await this.where(actor, query);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(actor: AccessTokenPayload, id: string, businessId?: string) {
    const selected = await this.business(actor, businessId);
    const item = await this.prisma.auditLog.findFirst({
      where: { id, businessId: selected },
    });
    if (!item) throw new NotFoundException('Audit log not found');
    return item;
  }
}
