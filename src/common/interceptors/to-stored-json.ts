import { Prisma } from '@prisma/client';

export function toStoredJson(body: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(body ?? null, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}
