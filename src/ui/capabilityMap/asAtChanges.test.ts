import { describe, expect, it } from 'vitest';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { capabilitiesChangedByDate } from './asAtChanges';

const edge = (from: string, to: string): RelationshipsHeadRow => ({ relationship_type: 'supports', from_element_id: from, to_element_id: to }) as unknown as RelationshipsHeadRow;

describe('capabilitiesChangedByDate', () => {
  it('lists a capability whose supporting systems differ', () => {
    const changed = capabilitiesChangedByDate(new Set(['c1', 'c2']), new Set(['c1', 'c2']), [edge('s1', 'c1'), edge('s1', 'c2')], [edge('s2', 'c1'), edge('s1', 'c2')]);
    expect([...changed]).toEqual(['c1']);
  });
  it('lists a capability that gains its first system or only exists by the date', () => {
    const changed = capabilitiesChangedByDate(new Set(['c1']), new Set(['c1', 'c2']), [], [edge('s1', 'c1')]);
    expect([...changed].sort()).toEqual(['c1', 'c2']);
  });
  it('lists nothing when nothing differs', () => {
    expect(capabilitiesChangedByDate(new Set(['c1']), new Set(['c1']), [edge('s1', 'c1')], [edge('s1', 'c1')]).size).toBe(0);
  });
});
