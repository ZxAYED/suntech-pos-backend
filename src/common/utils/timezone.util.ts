import { BadRequestException } from '@nestjs/common';

export const BUSINESS_TIMEZONE = 'Asia/Dhaka';

// Bangladesh Standard Time offset: UTC+6 (fixed, no daylight saving time)
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface DateRange {
  gte: Date;
  lt: Date;
  /** @deprecated Use exclusive `lt` */
  lte?: Date;
}

/**
 * Returns year, month (1-12), and day for a given date in Asia/Dhaka.
 */
export function getDhakaDateParts(date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = dtf.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }
  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
  };
}

/**
 * Constructs a UTC Date representing start of day (00:00:00.000) in Asia/Dhaka.
 */
export function getDhakaStartOfDay(date = new Date()): Date {
  const { year, month, day } = getDhakaDateParts(date);
  // 00:00:00 in UTC+6 is (00:00:00 - 6 hours) in UTC
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  return new Date(utcMs);
}

/**
 * Constructs a UTC Date representing end of day (23:59:59.999) in Asia/Dhaka.
 */
export function getDhakaEndOfDay(date = new Date()): Date {
  const { year, month, day } = getDhakaDateParts(date);
  const utcMs =
    Date.UTC(year, month - 1, day, 23, 59, 59, 999) - DHAKA_OFFSET_MS;
  return new Date(utcMs);
}

/**
 * Returns half-open UTC boundaries [start, nextStart) for a single calendar day in Asia/Dhaka.
 */
export function getDhakaDayRange(date = new Date()): {
  start: Date;
  nextStart: Date;
} {
  const start = getDhakaStartOfDay(date);
  const nextStart = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, nextStart };
}

/**
 * Computes report date ranges according to business calendar boundaries in Asia/Dhaka.
 * Boundaries are half-open [gte, lt), with deprecated lte = lt - 1ms provided for compatibility.
 */
export function getDhakaReportDateRange(
  range?: string,
  now = new Date(),
): DateRange {
  const { start: startOfToday, nextStart } = getDhakaDayRange(now);

  switch (range?.toLowerCase()) {
    case 'yesterday': {
      const yesterdayStart = new Date(
        startOfToday.getTime() - 24 * 60 * 60 * 1000,
      );
      return {
        gte: yesterdayStart,
        lt: startOfToday,
        lte: new Date(startOfToday.getTime() - 1),
      };
    }
    case 'today':
    case 'daily': {
      return {
        gte: startOfToday,
        lt: nextStart,
        lte: new Date(nextStart.getTime() - 1),
      };
    }
    case 'weekly': {
      const sevenDaysAgo = new Date(
        nextStart.getTime() - 7 * 24 * 60 * 60 * 1000,
      );
      return {
        gte: sevenDaysAgo,
        lt: nextStart,
        lte: new Date(nextStart.getTime() - 1),
      };
    }
    case 'quarterly': {
      const ninetyDaysAgo = new Date(
        nextStart.getTime() - 90 * 24 * 60 * 60 * 1000,
      );
      return {
        gte: ninetyDaysAgo,
        lt: nextStart,
        lte: new Date(nextStart.getTime() - 1),
      };
    }
    case 'monthly':
    default: {
      const thirtyDaysAgo = new Date(
        nextStart.getTime() - 30 * 24 * 60 * 60 * 1000,
      );
      return {
        gte: thirtyDaysAgo,
        lt: nextStart,
        lte: new Date(nextStart.getTime() - 1),
      };
    }
  }
}

/**
 * Returns UTC boundaries for a calendar month in Asia/Dhaka (e.g. "2026-10").
 * Bounds are half-open [start, end), where end is the exclusive start of the next month.
 */
export function getDhakaMonthBounds(monthStr?: string): {
  start: Date;
  end: Date;
} {
  let year: number;
  let month: number;

  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [y, m] = monthStr.split('-').map(Number);
    if (y < 2000 || y > 2100 || m < 1 || m > 12) {
      throw new BadRequestException('Invalid month string: must be YYYY-MM');
    }
    year = y;
    month = m;
  } else {
    const parts = getDhakaDateParts();
    year = parts.year;
    month = parts.month;
  }

  const startUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  // Exclusive start of the next month (e.g. 1st of next month 00:00:00.000 in UTC+6)
  const endUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;

  return {
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
  };
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parses user/frontend provided month value into numeric month 1-12.
 * Supports:
 * - Number: 1 to 12
 * - String: "1" to "12", "01" to "12"
 * - Month names: "january", "jan", "october", "oct", etc. (case-insensitive)
 * - Keywords: "current", "this-month", "now"
 */
export function parseMonthNumber(
  monthVal?: string | number,
  now = new Date(),
): number | undefined {
  if (monthVal === undefined || monthVal === null || monthVal === '') {
    return undefined;
  }
  if (typeof monthVal === 'number' && monthVal >= 1 && monthVal <= 12) {
    return Math.floor(monthVal);
  }
  const str = String(monthVal).trim().toLowerCase();
  if (str === 'current' || str === 'this-month' || str === 'now') {
    return getDhakaDateParts(now).month;
  }
  const num = parseInt(str, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return num;
  }
  return MONTH_NAMES[str];
}

export interface ReportDateFilterOptions {
  range?: string;
  month?: string | number;
  year?: string | number;
  week?: string | number;
}

/**
 * Returns UTC boundaries for a specific calendar month in Asia/Dhaka.
 */
export function getDhakaMonthRange(year: number, month: number): DateRange {
  if (month < 1 || month > 12) {
    throw new BadRequestException('Month must be between 1 and 12');
  }
  const startUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  const nextMonthUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  return {
    gte: new Date(startUtcMs),
    lt: new Date(nextMonthUtcMs),
    lte: new Date(nextMonthUtcMs - 1),
  };
}

/**
 * Returns UTC boundaries for an entire calendar year in Asia/Dhaka.
 */
export function getDhakaYearRange(year: number): DateRange {
  const startUtcMs = Date.UTC(year, 0, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  const nextYearUtcMs = Date.UTC(year + 1, 0, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  return {
    gte: new Date(startUtcMs),
    lt: new Date(nextYearUtcMs),
    lte: new Date(nextYearUtcMs - 1),
  };
}

/**
 * Returns UTC boundaries for current ISO calendar week (Monday 00:00:00 to Sunday 23:59:59) in Asia/Dhaka.
 */
export function getDhakaCurrentWeekRange(now = new Date()): DateRange {
  const startOfToday = getDhakaStartOfDay(now);
  const { year, month, day } = getDhakaDateParts(now);
  const dhakaDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dhakaDate.getUTCDay(); // 0 is Sun, 1 is Mon...
  const distanceToMonday = (dayOfWeek + 6) % 7; // 0 if Mon, 6 if Sun
  const mondayMs =
    startOfToday.getTime() - distanceToMonday * 24 * 60 * 60 * 1000;
  const nextMondayMs = mondayMs + 7 * 24 * 60 * 60 * 1000;
  return {
    gte: new Date(mondayMs),
    lt: new Date(nextMondayMs),
    lte: new Date(nextMondayMs - 1),
  };
}

/**
 * Returns the number of ISO weeks (52 or 53) in a given ISO year.
 */
export function getWeeksInIsoYear(year: number): number {
  const jan4This = new Date(Date.UTC(year, 0, 4));
  const mon1This =
    jan4This.getTime() - ((jan4This.getUTCDay() + 6) % 7) * 86400000;
  const jan4Next = new Date(Date.UTC(year + 1, 0, 4));
  const mon1Next =
    jan4Next.getTime() - ((jan4Next.getUTCDay() + 6) % 7) * 86400000;
  return Math.round((mon1Next - mon1This) / (7 * 86400000));
}

/**
 * Returns UTC boundaries for a specific ISO week in a given year in Asia/Dhaka.
 */
export function getDhakaIsoWeekRange(year: number, week: number): DateRange {
  const maxWeeks = getWeeksInIsoYear(year);
  if (week < 1 || week > maxWeeks) {
    throw new BadRequestException(
      `Week must be between 1 and ${maxWeeks} for year ${year}`,
    );
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay();
  const jan4Monday = jan4.getTime() - ((jan4Day + 6) % 7) * 24 * 60 * 60 * 1000;
  const targetMondayMs = jan4Monday + (week - 1) * 7 * 24 * 60 * 60 * 1000;
  const startUtc = targetMondayMs - DHAKA_OFFSET_MS;
  const nextMondayUtc = startUtc + 7 * 24 * 60 * 60 * 1000;
  return {
    gte: new Date(startUtc),
    lt: new Date(nextMondayUtc),
    lte: new Date(nextMondayUtc - 1),
  };
}

const ALLOWED_RANGES = new Set([
  'today',
  'yesterday',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'week',
  'month',
  'year',
]);

/**
 * Universal date range resolver supporting:
 * - month name or code: 'october', 'oct', '10', 10, 'current', '2026-10'
 * - week: week number 1-53 or 'current' / 'this-week'
 * - year: calendar year e.g. 2026
 * - range: 'today', 'yesterday', 'daily', 'weekly', 'monthly', 'quarterly', 'week', 'month', 'year'
 * Default: month/range="month" defaults to current month in Dhaka.
 */
export function resolveDhakaDateRange(
  options?: ReportDateFilterOptions,
  now = new Date(),
): DateRange {
  if (!options) {
    return getDhakaReportDateRange('monthly', now);
  }

  const { range, month: rawMonth, year: rawYear, week: rawWeek } = options;

  let year: number = getDhakaDateParts(now).year;
  if (
    rawYear !== undefined &&
    rawYear !== null &&
    String(rawYear).trim() !== ''
  ) {
    const parsedYear = Number(rawYear);
    if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      throw new BadRequestException(
        'Invalid year filter: must be an integer between 2000 and 2100',
      );
    }
    year = parsedYear;
  }

  // 1. Explicit month provided (e.g. "october", "oct", "10", 10, "2026-10", "current")
  if (
    rawMonth !== undefined &&
    rawMonth !== null &&
    String(rawMonth).trim() !== ''
  ) {
    const monthStr = String(rawMonth).trim();
    if (/^\d{4}-\d{1,2}$/.test(monthStr)) {
      const [y, m] = monthStr.split('-').map(Number);
      if (y < 2000 || y > 2100 || m < 1 || m > 12) {
        throw new BadRequestException(
          'Invalid month filter: year must be 2000-2100 and month must be 1-12',
        );
      }
      return getDhakaMonthRange(y, m);
    }
    const month = parseMonthNumber(rawMonth, now);
    if (!month) {
      throw new BadRequestException(
        `Invalid month filter: unrecognized month value '${rawMonth}'`,
      );
    }
    return getDhakaMonthRange(year, month);
  }

  // 2. Explicit week provided (e.g. 42 or "current")
  if (
    rawWeek !== undefined &&
    rawWeek !== null &&
    String(rawWeek).trim() !== ''
  ) {
    const weekStr = String(rawWeek).trim().toLowerCase();
    if (weekStr === 'current' || weekStr === 'this-week') {
      return getDhakaCurrentWeekRange(now);
    }
    const weekNum = parseInt(weekStr, 10);
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
      throw new BadRequestException(
        'Invalid week filter: must be an integer between 1 and 53',
      );
    }
    return getDhakaIsoWeekRange(year, weekNum);
  }

  // 3. Normalized range names ('month', 'week', 'year', or legacy presets)
  if (range !== undefined && range !== null && String(range).trim() !== '') {
    const normalizedRange = range.trim().toLowerCase();
    if (!ALLOWED_RANGES.has(normalizedRange)) {
      throw new BadRequestException(
        `Invalid range filter: '${range}' is not a recognized preset`,
      );
    }
    if (normalizedRange === 'month') {
      const currentMonth = getDhakaDateParts(now).month;
      return getDhakaMonthRange(year, currentMonth);
    }
    if (normalizedRange === 'week') {
      return getDhakaCurrentWeekRange(now);
    }
    if (normalizedRange === 'year') {
      return getDhakaYearRange(year);
    }
    return getDhakaReportDateRange(normalizedRange, now);
  }

  // 4. Explicit year provided without month, week, or range
  if (rawYear) {
    return getDhakaYearRange(year);
  }

  return getDhakaReportDateRange('monthly', now);
}

/**
 * Formats a Date into a YYYY-MM-DD string in Asia/Dhaka calendar time.
 */
export function formatDhakaDateString(date: Date): string {
  const { year, month, day } = getDhakaDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses a YYYY-MM-DD string into the UTC Date representing start-of-day in Asia/Dhaka.
 * Returns null if the format is invalid or if the date components are not real calendar dates.
 */
export function parseDhakaDateString(dateStr?: string | null): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  const [y, m, d] = dateStr.trim().split('-').map(Number);
  const maxDays = getDaysInMonth(y, m);
  if (m < 1 || m > 12 || d < 1 || d > maxDays) {
    return null;
  }
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  return new Date(utcMs);
}

/**
 * Derives whether an open shift is overdue (opened prior to today's Asia/Dhaka start of day).
 */
export function isShiftOverdue(
  openedAt: Date | string | null | undefined,
  status: string,
  now = new Date(),
): boolean {
  if (status !== 'OPEN' || !openedAt) return false;
  const dateObj = openedAt instanceof Date ? openedAt : new Date(openedAt);
  if (isNaN(dateObj.getTime())) return false;
  return dateObj.getTime() < getDhakaStartOfDay(now).getTime();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

export interface StrictInstantParseResult {
  isValid: boolean;
  date?: Date;
  rawString?: string;
  hasTimezone?: boolean;
  offsetMinutes?: number;
  errorType?: 'TIMEZONE_REQUIRED' | 'INVALID_TIMESTAMP';
  error?: string;
}

/**
 * Parses and validates a strict ISO 8601 calendar datetime string with an explicit
 * timezone offset (Z or +/-HH:mm).
 * Rejects timezone-free datetimes, date-only strings, malformed strings, and impossible calendar dates.
 */
export function parseStrictEventInstant(
  input?: unknown,
): StrictInstantParseResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Timestamp must be a non-empty string',
    };
  }

  const str = input.trim();

  // Date-only (e.g. YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return {
      isValid: false,
      errorType: 'TIMEZONE_REQUIRED',
      error:
        'Timestamp must be a full datetime with explicit timezone offset or Z',
      rawString: str,
    };
  }

  // Datetime missing timezone (e.g. YYYY-MM-DDTHH:mm:ss)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
    return {
      isValid: false,
      errorType: 'TIMEZONE_REQUIRED',
      error: 'Timestamp must contain an explicit timezone offset or Z',
      rawString: str,
    };
  }

  const fullPattern =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/;
  const match = str.match(fullPattern);

  if (!match) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Malformed timestamp format',
      rawString: str,
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionStr = match[7];
  const tzStr = match[8];

  if (year < 1000 || year > 9999) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Invalid year',
      rawString: str,
    };
  }

  if (month < 1 || month > 12) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Invalid month',
      rawString: str,
    };
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: `Invalid calendar date for month ${month}: day ${day}`,
      rawString: str,
    };
  }

  if (hour < 0 || hour > 23) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Invalid hour',
      rawString: str,
    };
  }

  if (minute < 0 || minute > 59) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Invalid minute',
      rawString: str,
    };
  }

  if (second < 0 || second > 59) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Invalid second',
      rawString: str,
    };
  }

  let ms = 0;
  if (fractionStr) {
    ms = Number(fractionStr.slice(0, 3).padEnd(3, '0'));
  }

  let offsetMinutes = 0;
  if (tzStr === 'Z') {
    offsetMinutes = 0;
  } else {
    const sign = tzStr[0] === '-' ? -1 : 1;
    const rawTz = tzStr.slice(1).replace(':', '');
    const tzHour = Number(rawTz.slice(0, 2));
    const tzMin = Number(rawTz.slice(2, 4));
    if (tzHour > 23 || tzMin > 59) {
      return {
        isValid: false,
        errorType: 'INVALID_TIMESTAMP',
        error: 'Invalid timezone offset',
        rawString: str,
      };
    }
    offsetMinutes = sign * (tzHour * 60 + tzMin);
  }

  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) -
    offsetMinutes * 60 * 1000;

  if (!Number.isFinite(utcMs)) {
    return {
      isValid: false,
      errorType: 'INVALID_TIMESTAMP',
      error: 'Non-finite timestamp',
      rawString: str,
    };
  }

  return {
    isValid: true,
    date: new Date(utcMs),
    rawString: str,
    offsetMinutes,
    hasTimezone: true,
  };
}

