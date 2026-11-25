import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ATOMIC_IDEMPOTENCY_KEY } from '../interceptors/atomic-idempotency';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT_KEY = 'idempotent';

export const Idempotent = (options: { atomic?: boolean } = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    SetMetadata(ATOMIC_IDEMPOTENCY_KEY, options.atomic === true),
    ApiHeader({
      name: 'Idempotency-Key',
      description:
        'Unique UUIDv4 idempotency key to prevent duplicate execution of this mutation',
      required: true,
      schema: {
        type: 'string',
        example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      },
    }),
  );
