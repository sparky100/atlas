import { describe, expect, it } from 'vitest';
import { compareCustomAttributeValues, sortKeyEquals } from './elementBrowseSort';

describe('F1 ("custom attributes") PR4: sortKeyEquals', () => {
  it('two equal fixed-column keys are equal; two different ones are not', () => {
    expect(sortKeyEquals('name', 'name')).toBe(true);
    expect(sortKeyEquals('name', 'owner')).toBe(false);
  });

  it('two custom keys with the same attribute key are equal; different keys are not', () => {
    expect(sortKeyEquals({ custom: 'region' }, { custom: 'region' })).toBe(true);
    expect(sortKeyEquals({ custom: 'region' }, { custom: 'priority' })).toBe(false);
  });

  it('a fixed-column key is never equal to a custom key, regardless of spelling', () => {
    expect(sortKeyEquals('name', { custom: 'name' })).toBe(false);
    expect(sortKeyEquals({ custom: 'name' }, 'name')).toBe(false);
  });
});

describe('F1 PR4: compareCustomAttributeValues', () => {
  it('compares two numbers numerically, not lexicographically', () => {
    expect(compareCustomAttributeValues(2, 10)).toBeLessThan(0);
  });

  it('sorts booleans false before true', () => {
    expect(compareCustomAttributeValues(false, true)).toBeLessThan(0);
    expect(compareCustomAttributeValues(true, false)).toBeGreaterThan(0);
    expect(compareCustomAttributeValues(true, true)).toBe(0);
  });

  it('compares strings (including ISO date strings) via localeCompare', () => {
    expect(compareCustomAttributeValues('apple', 'banana')).toBeLessThan(0);
    expect(compareCustomAttributeValues('2026-01-01', '2026-06-01')).toBeLessThan(0);
  });

  it('treats a missing value as sorting before any real string value', () => {
    expect(compareCustomAttributeValues(undefined, 'anything')).toBeLessThan(0);
    expect(compareCustomAttributeValues(undefined, undefined)).toBe(0);
  });
});
