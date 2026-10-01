import { describe, expect, it } from 'vitest';
import { countLine } from './reportCounts';

describe('countLine', () => {
  it('uses the singular for exactly one and the plural otherwise', () => {
    expect(countLine(0, 'crossing', 'crossings')).toBe('0 crossings');
    expect(countLine(1, 'crossing', 'crossings')).toBe('1 crossing');
    expect(countLine(7, 'crossing', 'crossings')).toBe('7 crossings');
  });

  it('never shows a number while loading or after an error', () => {
    expect(countLine(null, 'crossing', 'crossings')).toBe('Loading…');
    expect(countLine('error', 'crossing', 'crossings')).toBe("Couldn't load this count.");
  });
});
