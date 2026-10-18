import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessTokenPayload } from '../types/access-token-payload';

export interface LocationScope {
  businessId: string;
  locationId?: string;
}

export function resolveLocationScope(
  actor: AccessTokenPayload,
  requestedLocationId?: string,
): LocationScope {
  if (!actor?.businessId || typeof actor.businessId !== 'string') {
    throw new ForbiddenException('Business context is required');
  }

  if (actor.role === Role.CASHIER) {
    if (!actor.locationId || typeof actor.locationId !== 'string') {
      throw new ForbiddenException(
        'Cashier account must be assigned to an active business and branch location',
      );
    }

    const requested = requestedLocationId?.trim();
    if (requested && requested !== actor.locationId) {
      throw new ForbiddenException(
        'Cashiers can only access their assigned branch location',
      );
    }

    return {
      businessId: actor.businessId,
      locationId: actor.locationId,
    };
  }

  if (actor.role === Role.ADMIN) {
    return {
      businessId: actor.businessId,
      locationId: requestedLocationId?.trim() || undefined,
    };
  }

  return {
    businessId: actor.businessId,
    locationId: requestedLocationId?.trim() || undefined,
  };
}
