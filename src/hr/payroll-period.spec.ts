import { payrollPeriod } from './payroll-period';

describe('payrollPeriod', () => {
  it('uses Asia/Dhaka calendar-month boundaries', () => {
    const period = payrollPeriod(2026, 10);

    expect(period.start.toISOString()).toBe('2026-09-30T18:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-10-31T18:00:00.000Z');
  });
});
