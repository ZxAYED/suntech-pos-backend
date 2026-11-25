import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

export interface CanonicalOrderLine {
  variantId?: string | null;
  productName?: string | null;
  variantName?: string | null;
  categoryName?: string | null;
  quantity: number;
  unitPrice: number | string;
}

export interface SyncPayloadHashInput {
  clientOrderId: string;
  deviceId: string;
  businessId: string;
  locationId: string;
  cashierId: string;
  occurredAt: Date | string;
  orderType: string;
  paymentMethod?: string | null;
  tenderedAmount: number | string;
  shiftId?: string | null;
  clientReceiptNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  lines: CanonicalOrderLine[];
}

/**
 * Exact whole-BDT financial value canonicalization.
 * Rejects fractional amounts, overflow, and non-finite values rather than rounding.
 * Canonicalizes numbers like 100, "100", "100.00" to "100".
 */
export function canonicalizeMoney(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BadRequestException('Financial value must be a finite number');
    }
    if (!Number.isInteger(value)) {
      throw new BadRequestException(
        `Fractional whole-BDT amounts are not allowed: ${value}`,
      );
    }
    return String(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException('Financial value cannot be empty');
    }
    const match = trimmed.match(/^(-?\d+)(?:\.(0+))?$/);
    if (!match) {
      if (/^-?\d+\.\d+$/.test(trimmed)) {
        throw new BadRequestException(
          `Fractional whole-BDT amounts are not allowed: ${trimmed}`,
        );
      }
      throw new BadRequestException(
        `Invalid financial value format: ${trimmed}`,
      );
    }
    const intPart = match[1];
    return String(BigInt(intPart));
  }

  throw new BadRequestException('Financial value must be a number or string');
}

/**
 * Recursively serializes an object into a deterministic JSON string with sorted keys.
 */
export function deterministicStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(deterministicStringify).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${deterministicStringify((obj as Record<string, unknown>)[key])}`,
  );
  return `{${entries.join(',')}}`;
}

/**
 * Computes a versioned SHA-256 fingerprint of the original offline sync payload
 * and authenticated execution context.
 */
export function computeSyncPayloadHash(input: SyncPayloadHashInput): string {
  const occurredAtUtc =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : new Date(input.occurredAt).toISOString();

  const canonicalObj = {
    version: 'v1',
    clientOrderId: input.clientOrderId,
    deviceId: input.deviceId,
    businessId: input.businessId,
    locationId: input.locationId,
    cashierId: input.cashierId,
    occurredAt: occurredAtUtc,
    orderType: input.orderType,
    paymentMethod: input.paymentMethod || 'COD',
    tenderedAmount: canonicalizeMoney(input.tenderedAmount),
    shiftId:
      input.shiftId === null || input.shiftId === undefined
        ? null
        : input.shiftId.trim(),
    clientReceiptNumber: input.clientReceiptNumber?.trim() || null,
    customerName: input.customerName?.trim() || null,
    customerPhone: input.customerPhone?.trim() || null,
    notes: input.notes?.trim() || null,
    lines: (input.lines || []).map((line) => ({
      variantId: line.variantId?.trim() || null,
      productName: line.productName?.trim() || null,
      variantName: line.variantName?.trim() || null,
      categoryName: line.categoryName?.trim() || null,
      quantity: line.quantity,
      unitPrice: canonicalizeMoney(line.unitPrice),
    })),
  };

  const canonicalJson = deterministicStringify(canonicalObj);
  const hash = crypto.createHash('sha256').update(canonicalJson).digest('hex');
  return `v1:${hash}`;
}

