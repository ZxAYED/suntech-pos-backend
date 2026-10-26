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
  if (actor.role === Role.CASHIER) {
    if (!actor.businessId || typeof actor.businessId !== 'string') {
      throw new ForbiddenException('Business context is required');
    }
    if (!actor.locationId || typeof actor.locationId !== 'string') {
      throw new ForbiddenException(
        'Cashier account must be assigned to an active business and branch location',
      );
    }

    return {
      businessId: actor.businessId,
      locationId: actor.locationId,
    };
  }

  let effectiveBusinessId = requestedBusinessId?.trim() || actor?.businessId;
  if (
    !effectiveBusinessId &&
    actor?.businessIds &&
    actor.businessIds.length === 1
  ) {
    effectiveBusinessId = actor.businessIds[0];
  }

  if (!effectiveBusinessId || typeof effectiveBusinessId !== 'string') {
    throw new ForbiddenException('Business context is required');
  }

  if (actor.role === Role.ADMIN) {
    const ownedBusinessIds = new Set(actor.businessIds ?? []);
    if (actor.businessId) {
      ownedBusinessIds.add(actor.businessId);
    }
    if (!ownedBusinessIds.has(effectiveBusinessId)) {
      throw new ForbiddenException(
        'You can only access businesses owned by your account',
      );
    }
  }

  return {
    businessId: effectiveBusinessId,
    locationId: requestedLocationId?.trim() || undefined,
  };
}
