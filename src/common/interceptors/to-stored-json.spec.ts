import { toStoredJson } from './to-stored-json';

describe('toStoredJson', () => {
  it('stores bigint totals as decimal strings', () => {
    expect(toStoredJson({ total: 15000n, label: 'payroll' })).toEqual({
      total: '15000',
      label: 'payroll',
    });
  });
});
