import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { lifecycleTagFor } from './lifecycleTagFor';
import { lifecycleTagText, plainDate } from './lifecycleTagText';

const el = (attributes: Record<string, string>, parent_id: string | null = null): ElementsHeadRow => ({ element_id: 'e', element_type: 'system', name: 'e', parent_id, attributes, exists_delta_id: 'd' });
const NOW = new Date('2026-11-16T00:00:00Z');

describe('lifecycle tag', () => {
  it('words', () => {
    expect(plainDate('2027-08-28')).toBe('28 Aug 2027');
    expect(lifecycleTagText('planned', { introduced: '2027-08-28' })).toBe('Planned · from 28 Aug 2027');
    expect(lifecycleTagText('retired', { plannedEnd: '2026-12-31' })).toBe('Retired · to 31 Dec 2026');
    expect(lifecycleTagText('retired', {})).toBe('Retired');
  });
  it('an active element carries no tag; planned and retired ones do', () => {
    expect(lifecycleTagFor(el({}), null, NOW)).toBeUndefined();
    expect(lifecycleTagFor(el({ introduced: '2027-08-28' }), null, NOW)).toEqual({ state: 'planned', introduced: '2027-08-28', plannedEnd: undefined });
    expect(lifecycleTagFor(el({ plannedEnd: '2026-01-01' }), null, NOW)?.state).toBe('retired');
  });
});
