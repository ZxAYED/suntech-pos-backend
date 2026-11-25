import { BadRequestException } from '@nestjs/common';
import {
  canonicalizeMoney,
  computeSyncPayloadHash,
  SyncPayloadHashInput,
} from './sync-payload-hash';

describe('sync-payload-hash', () => {
  describe('canonicalizeMoney', () => {
    it('canonicalizes integers and numeric strings with trailing zeros', () => {
      expect(canonicalizeMoney(100)).toBe('100');
      expect(canonicalizeMoney('100')).toBe('100');
      expect(canonicalizeMoney('100.00')).toBe('100');
      expect(canonicalizeMoney('100.000')).toBe('100');
      expect(canonicalizeMoney(0)).toBe('0');
      expect(canonicalizeMoney('0.00')).toBe('0');
      expect(canonicalizeMoney('00500')).toBe('500');
    });

    it('rejects fractional whole-BDT amounts without lossy rounding', () => {
      expect(() => canonicalizeMoney(100.5)).toThrow(BadRequestException);
      expect(() => canonicalizeMoney('100.50')).toThrow(BadRequestException);
      expect(() => canonicalizeMoney('100.01')).toThrow(BadRequestException);
    });

    it('rejects invalid or non-finite inputs', () => {
      expect(() => canonicalizeMoney(NaN)).toThrow(BadRequestException);
      expect(() => canonicalizeMoney(Infinity)).toThrow(BadRequestException);
      expect(() => canonicalizeMoney('abc')).toThrow(BadRequestException);
      expect(() => canonicalizeMoney('')).toThrow(BadRequestException);
      expect(() => canonicalizeMoney(null)).toThrow(BadRequestException);
    });
  });

  describe('computeSyncPayloadHash', () => {
    const baseInput: SyncPayloadHashInput = {
      clientOrderId: 'a4b8e9f0-1111-4222-8333-123456789abc',
      deviceId: 'counter-01',
      businessId: 'biz-1',
      locationId: 'loc-1',
      cashierId: 'cashier-1',
      occurredAt: '2026-11-06T18:10:00.000Z',
      orderType: 'CATALOG',
      paymentMethod: 'COD',
      tenderedAmount: 1500,
      shiftId: null,
      clientReceiptNumber: 'RCPT-01',
      customerName: 'Rahim',
      customerPhone: '01711111111',
      notes: 'Test sale',
      lines: [
        {
          variantId: 'var-1',
          productName: 'Item 1',
          variantName: 'Red',
          quantity: 2,
          unitPrice: 750,
        },
      ],
    };

    it('generates a consistent v1: prefixed SHA-256 hash', () => {
      const hash1 = computeSyncPayloadHash(baseInput);
      const hash2 = computeSyncPayloadHash(baseInput);
      expect(hash1).toMatch(/^v1:[a-f0-9]{64}$/);
      expect(hash1).toBe(hash2);
    });

    it('produces identical hash for equivalent ISO offsets representing the same instant', () => {
      const hashUtc = computeSyncPayloadHash({
        ...baseInput,
        occurredAt: '2026-11-06T18:10:00.000Z',
      });
      const hashDhakaOffset = computeSyncPayloadHash({
        ...baseInput,
        occurredAt: '2026-11-07T00:10:00+06:00',
      });
      expect(hashUtc).toBe(hashDhakaOffset);
    });

    it('produces identical hash for omitted vs explicit null shiftId', () => {
      const hashExplicitNull = computeSyncPayloadHash({
        ...baseInput,
        shiftId: null,
      });
      const hashOmitted = computeSyncPayloadHash({
        ...baseInput,
        shiftId: undefined,
      });
      expect(hashExplicitNull).toBe(hashOmitted);
    });

    it('produces identical hash for equivalent numeric and string money forms', () => {
      const hashNumber = computeSyncPayloadHash({
        ...baseInput,
        tenderedAmount: 1500,
        lines: [{ ...baseInput.lines[0], unitPrice: 750 }],
      });
      const hashString = computeSyncPayloadHash({
        ...baseInput,
        tenderedAmount: '1500.00',
        lines: [{ ...baseInput.lines[0], unitPrice: '750.0' }],
      });
      expect(hashNumber).toBe(hashString);
    });

    it('produces different hash when any payload property changes', () => {
      const hash1 = computeSyncPayloadHash(baseInput);

      expect(
        computeSyncPayloadHash({ ...baseInput, deviceId: 'counter-02' }),
      ).not.toBe(hash1);
      expect(
        computeSyncPayloadHash({ ...baseInput, cashierId: 'cashier-2' }),
      ).not.toBe(hash1);
      expect(
        computeSyncPayloadHash({ ...baseInput, locationId: 'loc-2' }),
      ).not.toBe(hash1);
      expect(
        computeSyncPayloadHash({ ...baseInput, paymentMethod: 'BKASH' }),
      ).not.toBe(hash1);
      expect(
        computeSyncPayloadHash({ ...baseInput, tenderedAmount: 2000 }),
      ).not.toBe(hash1);
      expect(
        computeSyncPayloadHash({
          ...baseInput,
          lines: [{ ...baseInput.lines[0], quantity: 3 }],
        }),
      ).not.toBe(hash1);
    });
  });
});

