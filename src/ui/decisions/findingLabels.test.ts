import { describe, expect, it } from 'vitest';
import { findingLabel } from './findingLabels';

describe('findingLabel', () => {
  it('names a known finding in plain words', () => {
    expect(findingLabel('critical-exposed')).toBe('a critical system with exposure');
  });
  it('is null for nothing or a key it does not know, never the raw key', () => {
    expect(findingLabel(null)).toBeNull();
    expect(findingLabel('something-new')).toBeNull();
  });
});
