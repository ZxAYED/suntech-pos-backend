import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogEntry {
  actorId: string;
  businessId?: string | null;
  locationId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      // Security sanitize: Ensure no sensitive secrets or tokens are ever recorded in metadata
      const sanitizedMeta = entry.metadata
        ? this.sanitize(entry.metadata)
        : Prisma.JsonNull;

      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          businessId: entry.businessId ?? null,
          locationId: entry.locationId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: sanitizedMeta as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to record audit log: ${message}`);
    }
  }

  private sanitize(meta: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'otp',
      'refreshToken',
      'accessToken',
      'hash',
    ];
    const clean: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(meta)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        clean[key] = '[REDACTED]';
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        clean[key] = this.sanitize(val as Record<string, unknown>);
      } else {
        clean[key] = val;
      }
    }

    return clean;
  }
}
