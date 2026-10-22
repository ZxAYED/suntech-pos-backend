import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessTokenPayload } from '../types/access-token-payload';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedTenantContext {
  businessId: string;
  locationId?: string;
}

/**
 * Resolves tenant businessId and locationId with strict role separation:
 * - CASHIER: strictly extracts from the JWT token (cannot be overridden by params).
 * - ADMIN / SUPER_ADMIN: extracts from query/param, falling back to database ownership.
 */
export async function resolveTenantContext(
  prisma: PrismaService,
  actor: AccessTokenPayload,
  requestedBusinessId?: string,
  requestedLocationId?: string,
): Promise<ResolvedTenantContext> {
  if (actor.role === Role.CASHIER) {
    if (
      !actor.businessId ||
      !actor.locationId ||
      typeof actor.businessId !== 'string' ||
      typeof actor.locationId !== 'string'
    ) {
      throw new ForbiddenException(
        'Cashier account must be assigned to an active business and branch location',
      );
    }

    const requestedLoc = requestedLocationId?.trim();
    if (requestedLoc && requestedLoc !== actor.locationId) {
      throw new ForbiddenException(
        'Cashiers can only access their assigned branch location',
      );
    }

    return {
      businessId: actor.businessId,
      locationId: actor.locationId,
    };
  }

  let businessId = requestedBusinessId?.trim() || actor.businessId;

  if (!businessId && actor.role === Role.ADMIN) {
    const adminUser = await prisma.user.findFirst({
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

    businessId = adminUser?.businessId || adminUser?.ownedBusinesses?.[0]?.id || undefined;
  }

  if (!businessId) {
    throw new ForbiddenException(
      actor.role === Role.SUPER_ADMIN
        ? 'Business ID parameter is required'
        : 'Create a business before continuing',
    );
  }

  return {
    businessId,
    locationId: requestedLocationId?.trim() || undefined,
  };
}
