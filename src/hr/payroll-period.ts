import { getDhakaMonthBounds } from '../common/utils/timezone.util';

export function payrollPeriod(
  year: number,
  month: number,
): { start: Date; end: Date } {
  return getDhakaMonthBounds(`${year}-${String(month).padStart(2, '0')}`);
}
