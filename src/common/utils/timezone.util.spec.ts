import { BadRequestException } from '@nestjs/common';
import {
  BUSINESS_TIMEZONE,
  formatDhakaDateString,
  getDhakaCurrentWeekRange,
  getDhakaDateParts,
  getDhakaDayRange,
  getDhakaIsoWeekRange,
  getDhakaMonthBounds,
  getDhakaMonthRange,
  getDhakaReportDateRange,
  getDhakaStartOfDay,
  getDhakaYearRange,
  getWeeksInIsoYear,
  isLeapYear,
  isShiftOverdue,
  parseDhakaDateString,
  parseStrictEventInstant,
  resolveDhakaDateRange,
} from './timezone.util';

describe('timezone.util', () => {
  describe('BUSINESS_TIMEZONE and getDhakaDateParts', () => {
    it('uses Asia/Dhaka as business timezone', () => {
      expect(BUSINESS_TIMEZONE).toBe('Asia/Dhaka');
    });

    it('correctly maps UTC instant to Dhaka business date across UTC midnight', () => {
      // 2026-11-06 18:10:00 UTC is 2026-11-07 00:10:00 in Dhaka (UTC+6)
      const instant = new Date('2026-11-06T18:10:00.000Z');
      const parts = getDhakaDateParts(instant);
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(11);
      expect(parts.day).toBe(7);

      expect(formatDhakaDateString(instant)).toBe('2026-11-07');
    });

    it('handles Dhaka 23:59:59 followed by 00:00:01 next day', () => {
      // 2026-11-06 17:59:59 UTC -> 2026-11-06 23:59:59 Dhaka
      const evening = new Date('2026-11-06T17:59:59.000Z');
      expect(formatDhakaDateString(evening)).toBe('2026-11-06');

      // 2026-11-06 18:00:01 UTC -> 2026-11-07 00:00:01 Dhaka
      const nextMidnight = new Date('2026-11-06T18:00:01.000Z');
      expect(formatDhakaDateString(nextMidnight)).toBe('2026-11-07');
    });
  });

  describe('parseStrictEventInstant', () => {
    it('parses valid ISO instant with Z offset', () => {
      const result = parseStrictEventInstant('2026-11-06T18:10:00.000Z');
      expect(result.isValid).toBe(true);
      expect(result.date?.toISOString()).toBe('2026-11-06T18:10:00.000Z');
      expect(result.offsetMinutes).toBe(0);
      expect(result.hasTimezone).toBe(true);
    });

    it('parses valid ISO instant with positive offset (+06:00)', () => {
      const result = parseStrictEventInstant('2026-11-07T00:10:00+06:00');
      expect(result.isValid).toBe(true);
      expect(result.date?.toISOString()).toBe('2026-11-06T18:10:00.000Z');
      expect(result.offsetMinutes).toBe(360);
    });

    it('parses valid ISO instant with negative offset (-05:00)', () => {
      const result = parseStrictEventInstant('2026-11-06T13:10:00-05:00');
      expect(result.isValid).toBe(true);
      expect(result.date?.toISOString()).toBe('2026-11-06T18:10:00.000Z');
      expect(result.offsetMinutes).toBe(-300);
    });

    it('rejects datetime string without timezone offset', () => {
      const result = parseStrictEventInstant('2026-11-07T00:10:00');
      expect(result.isValid).toBe(false);
      expect(result.errorType).toBe('TIMEZONE_REQUIRED');
      expect(result.error).toContain('explicit timezone offset');
    });

    it('rejects date-only string where full instant is required', () => {
      const result = parseStrictEventInstant('2026-11-07');
      expect(result.isValid).toBe(false);
      expect(result.errorType).toBe('TIMEZONE_REQUIRED');
    });

    it('rejects impossible calendar date like Feb 29 on non-leap year', () => {
      expect(isLeapYear(2026)).toBe(false);
      const result = parseStrictEventInstant('2026-02-29T12:00:00Z');
      expect(result.isValid).toBe(false);
      expect(result.errorType).toBe('INVALID_TIMESTAMP');
      expect(result.error).toContain('Invalid calendar date');
    });

    it('accepts Feb 29 on leap year (e.g. 2024)', () => {
      expect(isLeapYear(2024)).toBe(true);
      const result = parseStrictEventInstant('2024-02-29T12:00:00Z');
      expect(result.isValid).toBe(true);
      expect(result.date?.toISOString()).toBe('2024-02-29T12:00:00.000Z');
    });

    it('rejects impossible calendar date like April 31 or Feb 30', () => {
      const apr31 = parseStrictEventInstant('2026-04-31T12:00:00Z');
      expect(apr31.isValid).toBe(false);
      expect(apr31.errorType).toBe('INVALID_TIMESTAMP');

      const feb30 = parseStrictEventInstant('2024-02-30T12:00:00Z');
      expect(feb30.isValid).toBe(false);
      expect(feb30.errorType).toBe('INVALID_TIMESTAMP');
    });

    it('rejects malformed or empty strings', () => {
      expect(parseStrictEventInstant('').isValid).toBe(false);
      expect(parseStrictEventInstant('not-a-date').isValid).toBe(false);
      expect(parseStrictEventInstant(null).isValid).toBe(false);
    });
  });

  describe('Calendar Boundaries [gte, lt) half-open', () => {
    const fixedNow = new Date('2026-11-07T08:00:00.000Z'); // 2:00 PM Dhaka

    it('getDhakaDayRange returns [00:00:00 Dhaka, next day 00:00:00 Dhaka)', () => {
      const { start, nextStart } = getDhakaDayRange(fixedNow);
      expect(formatDhakaDateString(start)).toBe('2026-11-07');
      expect(formatDhakaDateString(new Date(nextStart.getTime() - 1))).toBe(
        '2026-11-07',
      );
      expect(formatDhakaDateString(nextStart)).toBe('2026-11-08');
      expect(nextStart.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('getDhakaMonthBounds returns exclusive end boundary', () => {
      const bounds = getDhakaMonthBounds('2026-10');
      expect(bounds.start.toISOString()).toBe('2026-09-30T18:00:00.000Z'); // Oct 1 00:00:00 Dhaka
      expect(bounds.end.toISOString()).toBe('2026-10-31T18:00:00.000Z'); // Nov 1 00:00:00 Dhaka (exclusive)
    });

    it('getDhakaMonthRange provides gte and lt', () => {
      const range = getDhakaMonthRange(2026, 11);
      expect(formatDhakaDateString(range.gte)).toBe('2026-11-01');
      expect(formatDhakaDateString(new Date(range.lt.getTime() - 1))).toBe(
        '2026-11-30',
      );
      expect(formatDhakaDateString(range.lt)).toBe('2026-12-01');
    });

    it('getDhakaYearRange provides gte and lt for entire year', () => {
      const range = getDhakaYearRange(2026);
      expect(formatDhakaDateString(range.gte)).toBe('2026-01-01');
      expect(formatDhakaDateString(range.lt)).toBe('2027-01-01');
    });

    it('resolveDhakaDateRange rejects invalid year or month', () => {
      expect(() =>
        resolveDhakaDateRange({ year: '1990' }, fixedNow),
      ).toThrow(BadRequestException);

      expect(() =>
        resolveDhakaDateRange({ month: '15' }, fixedNow),
      ).toThrow(BadRequestException);

      expect(() =>
        resolveDhakaDateRange({ month: 'invalid-month' }, fixedNow),
      ).toThrow(BadRequestException);

      expect(() =>
        resolveDhakaDateRange({ week: '99' }, fixedNow),
      ).toThrow(BadRequestException);

      expect(() =>
        resolveDhakaDateRange({ range: 'unknown-preset' }, fixedNow),
      ).toThrow(BadRequestException);
    });
  });

  describe('parseDhakaDateString', () => {
    it('parses valid YYYY-MM-DD into Dhaka start of day UTC instant', () => {
      const parsed = parseDhakaDateString('2026-11-07');
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe('2026-11-06T18:00:00.000Z');
      expect(formatDhakaDateString(parsed!)).toBe('2026-11-07');
    });

    it('returns null for impossible calendar date', () => {
      expect(parseDhakaDateString('2026-02-30')).toBeNull();
      expect(parseDhakaDateString('2026-13-01')).toBeNull();
      expect(parseDhakaDateString('not-a-date')).toBeNull();
    });
  });

  describe('isShiftOverdue', () => {
    it('identifies an open shift opened on a prior day as overdue', () => {
      const now = new Date('2026-11-07T10:00:00.000Z');
      const yesterdayShift = new Date('2026-11-06T04:00:00.000Z');
      expect(isShiftOverdue(yesterdayShift, 'OPEN', now)).toBe(true);
    });

    it('identifies today shift as not overdue', () => {
      const now = new Date('2026-11-07T10:00:00.000Z');
      const todayShift = new Date('2026-11-07T03:00:00.000Z');
      expect(isShiftOverdue(todayShift, 'OPEN', now)).toBe(false);
    });
  });

  describe('ISO week calculations and range precedence', () => {
    it('accurately identifies ISO week counts (2024: 52, 2025: 52, 2026: 53)', () => {
      expect(getWeeksInIsoYear(2024)).toBe(52);
      expect(getWeeksInIsoYear(2025)).toBe(52);
      expect(getWeeksInIsoYear(2026)).toBe(53);
    });

    it('rejects week 53 for 52-week year and accepts for 53-week year', () => {
      expect(() => getDhakaIsoWeekRange(2025, 53)).toThrow(BadRequestException);
      const week53Range = getDhakaIsoWeekRange(2026, 53);
      expect(week53Range.gte).toBeInstanceOf(Date);
      expect(week53Range.lt.getTime() - week53Range.gte.getTime()).toBe(
        7 * 24 * 60 * 60 * 1000,
      );
    });

    it('preserves rolling weekly range even when incidental year is supplied', () => {
      const now = new Date('2026-11-07T12:00:00.000Z');
      const range = resolveDhakaDateRange({ range: 'weekly', year: 2026 }, now);
      // Rolling weekly is 7 days, NOT 365 days
      const durationDays =
        (range.lt.getTime() - range.gte.getTime()) / (24 * 60 * 60 * 1000);
      expect(durationDays).toBe(7);
    });
  });
});

