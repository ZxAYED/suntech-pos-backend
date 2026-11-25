import type { Prisma } from '@prisma/client';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';

/** Opt-in only. The domain service must store the response in its own transaction.
 * Do not route other handlers here until they implement the same contract. */
export const ATOMIC_IDEMPOTENCY_KEY = 'atomic-idempotency';
export interface AtomicStoredResponse {
  statusCode: number;
  responseBody: Prisma.JsonValue;
}
export interface AtomicReceiptContext {
  scopeId: string;
  key: string;
  path: string;
  requestHash: string;
  statusCode: number;
  message: string;
  response?: AtomicStoredResponse;
}
const requests = new WeakMap<object, AtomicReceiptContext>();
export function attachAtomicReceipt(request: object, context: AtomicReceiptContext): void {
  requests.set(request, context);
}
export function requireAtomicReceipt(request: object): AtomicReceiptContext {
  const context = requests.get(request);
  if (!context) throw new InternalServerErrorException('Atomic financial receipt context missing');
  return context;
}
/** A pre-upgrade pending reservation may represent a committed refund. Never reclaim it. */
export function readAtomicReplay(
  row: { path: string; requestHash: string | null; statusCode: number; responseBody: Prisma.JsonValue },
  context: AtomicReceiptContext,
): AtomicStoredResponse {
  if (row.path !== context.path || (row.requestHash && row.requestHash !== context.requestHash)) {
    throw new ConflictException('Idempotency key was already used for a different request');
  }
  if (row.statusCode === 0) {
    throw new ConflictException({ code: 'LEGACY_REFUND_REVIEW', message: 'The original refund outcome is not confirmed. Reconcile its original evidence; do not pay again.' });
  }
  return { statusCode: row.statusCode, responseBody: row.responseBody };
}
