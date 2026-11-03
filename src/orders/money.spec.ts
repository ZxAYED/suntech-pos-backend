import { BadRequestException } from '@nestjs/common';
import { INT_MAX, lineTotal, sumMoney } from './money';

describe('money.ts', () => {
  describe('lineTotal', () => {
    it('computes correct whole integer BDT line total', () => {
      expect(lineTotal(500, 3)).toBe(1500);
      expect(lineTotal(1500, 1)).toBe(1500);
      expect(lineTotal(0, 5)).toBe(0); // Zero price allowed for complimentary items
    });

    it('rejects negative price', () => {
      expect(() => lineTotal(-100, 2)).toThrow(BadRequestException);
    });

    it('rejects zero or negative quantity', () => {
      expect(() => lineTotal(500, 0)).toThrow(BadRequestException);
      expect(() => lineTotal(500, -1)).toThrow(BadRequestException);
    });

    it('rejects fractional price or quantity', () => {
      expect(() => lineTotal(99.99, 1)).toThrow(BadRequestException);
      expect(() => lineTotal(100, 1.5)).toThrow(BadRequestException);
    });

    it('rejects NaN, Infinity, -Infinity', () => {
      expect(() => lineTotal(NaN, 1)).toThrow(BadRequestException);
      expect(() => lineTotal(100, NaN)).toThrow(BadRequestException);
      expect(() => lineTotal(Infinity, 1)).toThrow(BadRequestException);
      expect(() => lineTotal(100, Infinity)).toThrow(BadRequestException);
      expect(() => lineTotal(-Infinity, 1)).toThrow(BadRequestException);
    });

    it('rejects prices and quantities exceeding INT_MAX', () => {
      expect(() => lineTotal(INT_MAX + 1, 1)).toThrow(BadRequestException);
      expect(() => lineTotal(1, INT_MAX + 1)).toThrow(BadRequestException);
    });

    it('rejects multiplication overflow past INT_MAX', () => {
      expect(() => lineTotal(2_000_000_000, 2)).toThrow(BadRequestException);
      expect(() => lineTotal(Math.floor(INT_MAX / 2) + 1, 2)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('sumMoney', () => {
    it('computes correct total sum for whole integer amounts', () => {
      expect(sumMoney([1000, 2000, 3500])).toBe(6500);
      expect(sumMoney([])).toBe(0);
      expect(sumMoney([0, 500, 0])).toBe(500);
    });

    it('rejects negative amount in array', () => {
      expect(() => sumMoney([500, -200, 300])).toThrow(BadRequestException);
    });

    it('rejects fractional amount in array', () => {
      expect(() => sumMoney([500, 200.5, 300])).toThrow(BadRequestException);
    });

    it('rejects NaN, Infinity, -Infinity', () => {
      expect(() => sumMoney([500, NaN])).toThrow(BadRequestException);
      expect(() => sumMoney([500, Infinity])).toThrow(BadRequestException);
    });

    it('rejects sum overflow past INT_MAX', () => {
      expect(() => sumMoney([INT_MAX, 1])).toThrow(BadRequestException);
      expect(() => sumMoney([1_500_000_000, 1_000_000_000])).toThrow(
        BadRequestException,
      );
    });
  });
});
