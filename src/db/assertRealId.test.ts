import { describe, expect, it } from 'vitest';
import { assertRealId } from './assertRealId';

describe('assertRealId', () => {
  it('does not throw for a real id', () => {
    expect(() => {
      assertRealId('getMainBranch', 'model_id', '11111111-1111-1111-1111-111111111111');
    }).not.toThrow();
  });

  it('throws for an empty string — the live bug this guard was written for (LandscapePage.tsx feeding resolveRef a hollow model_id)', () => {
    expect(() => {
      assertRealId('getMainBranch', 'model_id', '');
    }).toThrow(/getMainBranch/);
    expect(() => {
      assertRealId('getMainBranch', 'model_id', '');
    }).toThrow(/model_id/);
  });

  it('throws for null and undefined', () => {
    expect(() => {
      assertRealId('getBranch', 'id', null);
    }).toThrow(/getBranch/);
    expect(() => {
      assertRealId('getBranch', 'id', undefined);
    }).toThrow(/id/);
  });
});
