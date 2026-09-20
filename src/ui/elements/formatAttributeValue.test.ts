import { describe, expect, it } from 'vitest';
import { formatAttributeValue } from './formatAttributeValue';

describe('formatAttributeValue', () => {
  it('renders null/undefined as an empty string', () => {
    expect(formatAttributeValue(null)).toBe('');
    expect(formatAttributeValue(undefined)).toBe('');
  });

  it('renders booleans as Yes/No', () => {
    expect(formatAttributeValue(true)).toBe('Yes');
    expect(formatAttributeValue(false)).toBe('No');
  });

  it('renders strings and numbers plainly, with no quoting', () => {
    expect(formatAttributeValue('primary')).toBe('primary');
    expect(formatAttributeValue(42)).toBe('42');
  });

  it('falls back to JSON for arrays and objects', () => {
    expect(formatAttributeValue(['a', 'b'])).toBe('["a","b"]');
    expect(formatAttributeValue({ a: 1 })).toBe('{"a":1}');
  });
});
