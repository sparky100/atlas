import { describe, expect, it } from 'vitest';
import { assertInFilterSize, MAX_IN_FILTER_VALUES } from './inFilterLimit';

describe('assertInFilterSize', () => {
  it('does not throw at or under the limit', () => {
    expect(() => {
      assertInFilterSize('ctx', 'id', Array.from({ length: MAX_IN_FILTER_VALUES }, (_, i) => i));
    }).not.toThrow();
    expect(() => {
      assertInFilterSize('ctx', 'id', []);
    }).not.toThrow();
  });

  it('throws over the limit, naming the caller, column, and count', () => {
    const values = Array.from({ length: MAX_IN_FILTER_VALUES + 1 }, (_, i) => i);
    expect(() => {
      assertInFilterSize('getElementsByIds', 'element_id', values);
    }).toThrow(/getElementsByIds/);
    expect(() => {
      assertInFilterSize('getElementsByIds', 'element_id', values);
    }).toThrow(/element_id/);
    expect(() => {
      assertInFilterSize('getElementsByIds', 'element_id', values);
    }).toThrow(new RegExp(String(MAX_IN_FILTER_VALUES + 1)));
  });
});
