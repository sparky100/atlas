import { describe, expect, it } from 'vitest';
import { parseViewMode } from './viewMode';

describe('parseViewMode', () => {
  it('parses the three valid modes', () => {
    expect(parseViewMode('asIs')).toBe('asIs');
    expect(parseViewMode('toBe')).toBe('toBe');
    expect(parseViewMode('diff')).toBe('diff');
  });

  it('defaults to toBe for absent, null, or unrecognised values', () => {
    expect(parseViewMode(undefined)).toBe('toBe');
    expect(parseViewMode(null)).toBe('toBe');
    expect(parseViewMode('')).toBe('toBe');
    expect(parseViewMode('bogus')).toBe('toBe');
  });
});
