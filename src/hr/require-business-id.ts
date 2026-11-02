import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
    throw new BadRequestException('businessId is required');
  }

  if (actor.role === Role.ADMIN) {
    const ownedBusinessIds = new Set(actor.businessIds ?? []);
    if (actor.businessId) {
      ownedBusinessIds.add(actor.businessId);
    }
    if (!ownedBusinessIds.has(businessId)) {
      throw new ForbiddenException('You do not have access to this business');
    }
  }

  return businessId;
}
