export const BUSINESS_TIMEZONE = 'Asia/Dhaka';

// Bangladesh Standard Time offset: UTC+6 (fixed, no daylight saving time)
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface DateRange {
  gte: Date;
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
 * Computes report date ranges according to business calendar boundaries in Asia/Dhaka.
 */
export function getDhakaReportDateRange(
  range?: string,
  now = new Date(),
): DateRange {
  const startOfToday = getDhakaStartOfDay(now);
  const endOfToday = getDhakaEndOfDay(now);

  switch (range?.toLowerCase()) {
    case 'yesterday': {
      const yesterdayRef = new Date(
        startOfToday.getTime() - 12 * 60 * 60 * 1000,
      );
      return {
        gte: getDhakaStartOfDay(yesterdayRef),
        lte: getDhakaEndOfDay(yesterdayRef),
      };
    }
    case 'today':
    case 'daily': {
      return { gte: startOfToday, lte: endOfToday };
    }
    case 'weekly': {
      const sevenDaysAgo = new Date(
        startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000,
      );
      return { gte: sevenDaysAgo, lte: endOfToday };
    }
    case 'quarterly': {
      const ninetyDaysAgo = new Date(
        startOfToday.getTime() - 89 * 24 * 60 * 60 * 1000,
      );
      return { gte: ninetyDaysAgo, lte: endOfToday };
    }
    case 'monthly':
    default: {
      const thirtyDaysAgo = new Date(
        startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000,
      );
      return { gte: thirtyDaysAgo, lte: endOfToday };
    }
  }
}

/**
 * Returns UTC boundaries for a calendar month in Asia/Dhaka (e.g. "2026-10").
 */
export function getDhakaMonthBounds(monthStr?: string): {
  start: Date;
  end: Date;
} {
  let year: number;
  let month: number;

  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    const [y, m] = monthStr.split('-').map(Number);
    year = y;
    month = m;
  } else {
    const parts = getDhakaDateParts();
    year = parts.year;
    month = parts.month;
  }

  const startUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  // Last millisecond of month: 1st of next month minus 1ms
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
  const startUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  const endUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - 1 - DHAKA_OFFSET_MS;
  return {
    gte: new Date(startUtcMs),
    lte: new Date(endUtcMs),
  };
}

/**
 * Returns UTC boundaries for an entire calendar year in Asia/Dhaka.
 */
export function getDhakaYearRange(year: number): DateRange {
  const startUtcMs = Date.UTC(year, 0, 1, 0, 0, 0, 0) - DHAKA_OFFSET_MS;
  const endUtcMs = Date.UTC(year + 1, 0, 1, 0, 0, 0, 0) - 1 - DHAKA_OFFSET_MS;
  return {
    gte: new Date(startUtcMs),
    lte: new Date(endUtcMs),
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
  const sundayMs = mondayMs + 7 * 24 * 60 * 60 * 1000 - 1;
  return {
    gte: new Date(mondayMs),
    lte: new Date(sundayMs),
  };
}

/**
 * Returns UTC boundaries for a specific ISO week in a given year in Asia/Dhaka.
 */
export function getDhakaIsoWeekRange(year: number, week: number): DateRange {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay();
  const jan4Monday = jan4.getTime() - ((jan4Day + 6) % 7) * 24 * 60 * 60 * 1000;
  const targetMondayMs = jan4Monday + (week - 1) * 7 * 24 * 60 * 60 * 1000;
  const startUtc = targetMondayMs - DHAKA_OFFSET_MS;
  const endUtc = startUtc + 7 * 24 * 60 * 60 * 1000 - 1;
  return {
    gte: new Date(startUtc),
    lte: new Date(endUtc),
  };
}

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
    if (!isNaN(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100) {
      year = parsedYear;
    }
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
      return getDhakaMonthRange(y, m);
    }
    const month = parseMonthNumber(rawMonth, now);
    if (month) {
      return getDhakaMonthRange(year, month);
    }
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
    if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 53) {
      return getDhakaIsoWeekRange(year, weekNum);
    }
  }

  // 3. Explicit year provided without month or week
  if (
    rawYear &&
    !rawMonth &&
    !rawWeek &&
    range !== 'today' &&
    range !== 'yesterday'
  ) {
    return getDhakaYearRange(year);
  }

  // 4. Normalized range names ('month', 'week', 'year', or legacy presets)
  const normalizedRange = range?.trim().toLowerCase();
  if (normalizedRange === 'month') {
    // Current month in Dhaka
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
