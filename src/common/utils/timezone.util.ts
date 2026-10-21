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
  const utcMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - DHAKA_OFFSET_MS;
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
      const yesterdayRef = new Date(startOfToday.getTime() - 12 * 60 * 60 * 1000);
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
      const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { gte: sevenDaysAgo, lte: endOfToday };
    }
    case 'quarterly': {
      const ninetyDaysAgo = new Date(startOfToday.getTime() - 89 * 24 * 60 * 60 * 1000);
      return { gte: ninetyDaysAgo, lte: endOfToday };
    }
    case 'monthly':
    default: {
      const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000);
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
