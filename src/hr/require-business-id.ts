import { ForbiddenException } from '@nestjs/common';
import { AccessTokenPayload } from '../common/types/access-token-payload';

export function requireBusinessId(
  actor: AccessTokenPayload,
  requestedBusinessId?: string,
): string {
  const businessId = requestedBusinessId?.trim() || actor.businessId;
  if (!businessId) {
    throw new ForbiddenException('Create a business before continuing');
  }

  return businessId;
}
