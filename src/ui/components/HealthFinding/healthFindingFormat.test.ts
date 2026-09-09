import { describe, expect, it } from 'vitest';
import { joinWithMore, type HealthFindingItem } from './healthFindingFormat';

function items(labels: readonly string[]): HealthFindingItem[] {
  return labels.map((label, i) => ({ id: `id-${String(i)}`, label }));
}

describe('joinWithMore (Sprint U4-1 B3)', () => {
  it('joins up to three items with no "more" suffix', () => {
    expect(joinWithMore(items(['A', 'B', 'C']))).toBe('A, B, C');
  });

  it('joins fewer than three items with no "more" suffix', () => {
    expect(joinWithMore(items(['A']))).toBe('A');
  });

  it('shows the first three and "and N more" for anything beyond that', () => {
    expect(joinWithMore(items(['A', 'B', 'C', 'D', 'E']))).toBe('A, B, C, and 2 more');
  });

  it('an empty list joins to an empty string', () => {
    expect(joinWithMore([])).toBe('');
  });

  it('respects a custom max', () => {
    expect(joinWithMore(items(['A', 'B', 'C', 'D']), 2)).toBe('A, B, and 2 more');
  });
});
