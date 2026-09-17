import { describe, expect, it } from 'vitest';
import type { Json } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { landscapeInspectorNeighbours, landscapeInspectorOwnersByRole, landscapeInspectorSupports } from './landscapeInspectorSelection';

function system(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function relationship(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${id}` };
}

describe('landscapeInspectorNeighbours', () => {
  it('includes only edges touching the focused element, with a direction-correct verb and the recorded description alongside it', () => {
    const namesById = new Map([
      ['s1', system('s1', 'CRM')],
      ['s2', system('s2', 'Billing')],
      ['s3', system('s3', 'Unrelated')],
    ]);
    const edges = [
      relationship('r1', 'uses', 's1', 's2', { description: 'invoices via' }),
      relationship('r2', 'flows_to', 's3', 's3', { description: 'irrelevant' }),
    ];
    const result = landscapeInspectorNeighbours('s1', edges, namesById);
    expect(result).toEqual([{ relationshipId: 'r1', otherId: 's2', otherName: 'Billing', outbound: true, verb: 'uses', description: 'invoices via' }]);
  });

  it('uses the inbound verb (never the from-side description) for an edge pointing at the focused element, and omits an unset description', () => {
    const namesById = new Map([
      ['s1', system('s1', 'CRM')],
      ['s2', system('s2', 'Billing')],
    ]);
    const edges = [relationship('r1', 'uses', 's2', 's1', {})];
    const result = landscapeInspectorNeighbours('s1', edges, namesById);
    expect(result).toEqual([{ relationshipId: 'r1', otherId: 's2', otherName: 'Billing', outbound: false, verb: 'used by', description: undefined }]);
  });
});

describe('landscapeInspectorOwnersByRole', () => {
  it('groups owners by role, ignoring edges targeting a different element', () => {
    const actorsById = new Map([
      ['a1', actor('a1', 'Alice')],
      ['a2', actor('a2', 'Bob')],
    ]);
    const ownsEdges = [
      relationship('o1', 'owns', 'a1', 's1', { role: 'business' }),
      relationship('o2', 'owns', 'a2', 's1', { role: 'technical' }),
      relationship('o3', 'owns', 'a1', 's2', { role: 'business' }),
    ];
    const result = landscapeInspectorOwnersByRole('s1', ownsEdges, actorsById);
    expect([...result.entries()]).toEqual([
      ['business', [actorsById.get('a1')]],
      ['technical', [actorsById.get('a2')]],
    ]);
  });

  it('drops an edge whose owner is missing from actorsById rather than showing a broken row', () => {
    const result = landscapeInspectorOwnersByRole('s1', [relationship('o1', 'owns', 'missing', 's1', { role: 'business' })], new Map());
    expect(result.size).toBe(0);
  });
});

describe('landscapeInspectorSupports', () => {
  it('names each supports edge by its level-1 ancestor, carrying the role through', () => {
    const l1 = capability('c1', 'Customer Management');
    const l1AncestorByCapabilityId = new Map([['leaf', l1]]);
    const supportsEdges = [relationship('sp1', 'supports', 's1', 'leaf', { role: 'primary' }), relationship('sp2', 'supports', 's2', 'leaf', { role: 'primary' })];
    const result = landscapeInspectorSupports('s1', supportsEdges, l1AncestorByCapabilityId);
    expect(result).toEqual([{ capabilityId: 'c1', capabilityName: 'Customer Management', role: 'primary' }]);
  });

  it('omits a supports edge whose capability has no known level-1 ancestor', () => {
    const result = landscapeInspectorSupports('s1', [relationship('sp1', 'supports', 's1', 'leaf', {})], new Map());
    expect(result).toEqual([]);
  });
});
