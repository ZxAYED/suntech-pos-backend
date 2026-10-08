import { ForbiddenException } from '@nestjs/common';
import { AccessTokenPayload } from '../common/types/access-token-payload';

export function requireBusinessId(actor: AccessTokenPayload): string {
  if (!actor.businessId) {
    throw new ForbiddenException('Create a business before continuing');
  }

  return actor.businessId;
}
