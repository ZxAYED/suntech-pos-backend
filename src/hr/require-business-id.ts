import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';

export function requireBusinessId(
  actor: AccessTokenPayload,
  requestedBusinessId?: string,
): string {
  if (actor.role === Role.CASHIER) {
    if (!actor.businessId) {
      throw new ForbiddenException(
        'Cashier account must be assigned to an active business and branch location',
      );
    }
    return actor.businessId;
  }

  const businessId = requestedBusinessId?.trim() || actor.businessId;
  if (!businessId) {
    if (actor.businessIds && actor.businessIds.length === 1) {
      return actor.businessIds[0];
    }
    throw new ForbiddenException('Business context is required');
  }

  if (
    actor.role === Role.ADMIN &&
    actor.businessIds &&
    actor.businessIds.length > 0 &&
    !actor.businessIds.includes(businessId)
  ) {
    throw new ForbiddenException('You do not have access to this business');
  }

  return businessId;
}
