export function payrollPeriod(
  year: number,
  month: number,
): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
  };
}
