import { describe, expect, it } from 'vitest';
import { addMonthsIso, AS_AT_PRESETS, parseAsAtParam, presetAsAt, todayIsoDate } from './asAt';

describe('asAt', () => {
  it('formats today in local time', () => {
    expect(todayIsoDate(new Date(2026, 10, 9))).toBe('2026-11-09');
  });

  it('adds months, clamping to the end of a shorter month and crossing the year', () => {
    expect(addMonthsIso('2026-11-09', 6)).toBe('2027-05-09');
    expect(addMonthsIso('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonthsIso('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonthsIso('2026-11-09', 24)).toBe('2028-11-09');
  });

  it('makes Today the default and the others real dates', () => {
    const [today, six, year, two] = AS_AT_PRESETS;
    expect([today, six, year, two].map((p) => (p ? presetAsAt(p, '2026-11-09') : undefined))).toEqual([null, '2027-05-09', '2027-11-09', '2028-11-09']);
  });

  it('accepts only a real future date from the URL', () => {
    expect(parseAsAtParam('2027-01-15', '2026-11-09')).toBe('2027-01-15');
    expect(parseAsAtParam('2026-11-09', '2026-11-09')).toBeNull();
    expect(parseAsAtParam('2026-01-01', '2026-11-09')).toBeNull();
    expect(parseAsAtParam('2027-02-30', '2026-11-09')).toBeNull();
    expect(parseAsAtParam('next year', '2026-11-09')).toBeNull();
    expect(parseAsAtParam(null, '2026-11-09')).toBeNull();
  });
});
