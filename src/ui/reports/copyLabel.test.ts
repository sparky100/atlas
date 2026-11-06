import { describe, expect, it } from 'vitest';
import { copyLabel } from './copyLabel';

describe('copyLabel', () => {
  it('says as at date and short commit', () => {
    expect(copyLabel('2026-11-06T15:20:00.000Z', '0123456789abcdef')).toBe('as at 2026-11-06, 01234567');
  });
});
