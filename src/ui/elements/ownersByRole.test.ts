import { describe, expect, it } from 'vitest';
import type { Json } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { ownersByRole } from './ownersByRole';

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function relationship(id: string, from: string, to: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'owns', from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${id}` };
}

describe('ownersByRole', () => {
  it('groups owners by role, ignoring edges targeting a different element', () => {
    const actorsById = new Map([
      ['a1', actor('a1', 'Alice')],
      ['a2', actor('a2', 'Bob')],
    ]);
    const ownsEdges = [
      relationship('o1', 'a1', 's1', { role: 'business' }),
      relationship('o2', 'a2', 's1', { role: 'technical' }),
      relationship('o3', 'a1', 's2', { role: 'business' }),
    ];
    const result = ownersByRole('s1', ownsEdges, actorsById);
    expect([...result.entries()]).toEqual([
      ['business', [actorsById.get('a1')]],
      ['technical', [actorsById.get('a2')]],
    ]);
  });

  it('drops an edge whose owner is missing from actorsById rather than showing a broken row', () => {
    const result = ownersByRole('s1', [relationship('o1', 'missing', 's1', { role: 'business' })], new Map());
    expect(result.size).toBe(0);
  });

  it('works the same for a capability target as for a system target — the function takes no element-type-specific input', () => {
    const actorsById = new Map([['a1', actor('a1', 'Alice')]]);
    const result = ownersByRole('capability-1', [relationship('o1', 'a1', 'capability-1', { role: 'business' })], actorsById);
    expect([...result.entries()]).toEqual([['business', [actorsById.get('a1')]]]);
  });
});
