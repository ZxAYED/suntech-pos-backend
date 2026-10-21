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
  requestedBusinessId?: string,
): LocationScope {
  const effectiveBusinessId = requestedBusinessId?.trim() || actor?.businessId;

  if (actor.role === Role.CASHIER) {
    if (!actor.businessId || typeof actor.businessId !== 'string') {
      throw new ForbiddenException('Business context is required');
    }
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

  if (!effectiveBusinessId || typeof effectiveBusinessId !== 'string') {
    throw new ForbiddenException('Business context is required');
  }

  return {
    businessId: effectiveBusinessId,
    locationId: requestedLocationId?.trim() || undefined,
  };
}
