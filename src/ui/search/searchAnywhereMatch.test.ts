import { describe, expect, it } from 'vitest';
import { matchTitled } from './searchAnywhereMatch';

const item = (...texts: string[]) => ({ texts });

describe('matchTitled', () => {
  it('matches case-insensitively on any of an item\'s texts, ignoring surrounding spaces', () => {
    const items = [item('Retire the legacy CRM', 'retire-legacy-crm'), item('Data platform', 'data-platform')];
    expect(matchTitled(items, '  crm ')).toEqual([items[0]]);
    expect(matchTitled(items, 'DATA-PLAT')).toEqual([items[1]]);
  });

  it('ranks a title starting with the query above one only containing it, and keeps input order within a rank', () => {
    const contains = item('Replace the CRM');
    const startsA = item('CRM upgrade');
    const startsB = item('CRM retirement');
    expect(matchTitled([contains, startsA, startsB], 'crm')).toEqual([startsA, startsB, contains]);
  });

  it('returns nothing for an empty query and caps at the limit', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`Change ${String(i)}`));
    expect(matchTitled(items, '   ')).toEqual([]);
    expect(matchTitled(items, 'change')).toHaveLength(5);
    expect(matchTitled(items, 'change', 3)).toHaveLength(3);
  });
});
