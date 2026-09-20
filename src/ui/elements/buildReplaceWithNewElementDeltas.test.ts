import { describe, expect, it } from 'vitest';
import type { Json } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { buildReplaceWithNewElementDeltas } from './buildReplaceWithNewElementDeltas';

function system(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: parentId, attributes: { lifecycleStatus: 'active' }, exists_delta_id: `d-${id}` };
}

function container(id: string, name: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'container', name, parent_id: parentId, attributes: { lifecycleStatus: 'active' }, exists_delta_id: `d-${id}` };
}

function rel(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${id}` };
}

const NO_FACTS = new Map<string, FactsRow>();
const NO_RELATIONSHIP_FACTS = new Map<string, Map<string, FactsRow>>();

describe('buildReplaceWithNewElementDeltas', () => {
  it('creates the new element and retires the old one, with no relationships to transfer', () => {
    const a = system('a', 'Old System');
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.map((d) => d.kind)).toEqual(['element.create', 'element.update', 'element.update']);
    const create = deltas[0] as { elementId: string; elementType: string; name: string; parentId: string | null };
    expect(create.elementId).toBe(newElementId);
    expect(create.elementType).toBe('system');
    expect(create.name).toBe('New System');
    expect(create.parentId).toBeNull();
  });

  it('skips the lifecycleStatus delta when the element is already retiring', () => {
    const a = { ...system('a', 'Old System'), attributes: { lifecycleStatus: 'retiring' } };
    const { deltas } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.map((d) => d.kind)).toEqual(['element.create', 'element.update']);
    expect((deltas[1] as { attribute: string }).attribute).toBe('plannedEnd');
  });

  it('a container replacement inherits the old container\'s own parent', () => {
    const a = container('a', 'PM', 'platform-1');
    const { deltas } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New PM',
      sourceId: 'src',
      onMain: true,
    });

    expect((deltas[0] as { parentId: string | null }).parentId).toBe('platform-1');
  });

  it('transfers a supports edge to the new element as secondary, carrying its description', () => {
    const a = system('a', 'Old System');
    const supportsEdge = rel('r1', 'supports', 'a', 'cap-1', { role: 'primary', description: 'the main one' });
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [supportsEdge],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    const retract = deltas.find((d) => d.kind === 'relationship.retract') as { relationshipId: string; relationshipType: string };
    expect(retract.relationshipId).toBe('r1');
    expect(retract.relationshipType).toBe('supports');

    const created = deltas.find((d) => d.kind === 'relationship.create' && (d as unknown as { relationshipType: string }).relationshipType === 'supports') as unknown as {
      fromElementId: string;
      toElementId: string;
      attributes: Record<string, unknown>;
    };
    expect(created.fromElementId).toBe(newElementId);
    expect(created.toElementId).toBe('cap-1');
    expect(created.attributes).toEqual({ role: 'secondary', description: 'the main one' });
  });

  it('transfers an outbound uses edge, swapping only the A side', () => {
    const a = system('a', 'Old System');
    const usesEdge = rel('r2', 'uses', 'a', 'other-system', { description: 'looks up prices' });
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [usesEdge],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    const created = deltas.find((d) => d.kind === 'relationship.create') as unknown as { fromElementId: string; toElementId: string; attributes: Record<string, unknown> };
    expect(created.fromElementId).toBe(newElementId);
    expect(created.toElementId).toBe('other-system');
    expect(created.attributes).toEqual({ description: 'looks up prices' });
  });

  it('transfers an inbound flows_to edge, swapping only the A side and leaving the other endpoint as `from`', () => {
    const a = system('a', 'Old System');
    const flowsEdge = rel('r3', 'flows_to', 'other-system', 'a', { description: 'sends readings to', dataClassification: 'official' });
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [flowsEdge],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    const created = deltas.find((d) => d.kind === 'relationship.create') as unknown as { fromElementId: string; toElementId: string; attributes: Record<string, unknown> };
    expect(created.fromElementId).toBe('other-system');
    expect(created.toElementId).toBe(newElementId);
    expect(created.attributes).toEqual({ description: 'sends readings to', dataClassification: 'official' });
  });

  it('never transfers an owns edge, or a relationship where A is neither endpoint', () => {
    const a = system('a', 'Old System');
    const ownsEdge = rel('r4', 'owns', 'actor-1', 'a', { role: 'business' });
    const unrelatedEdge = rel('r5', 'uses', 'x', 'y');
    const { deltas } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [ownsEdge, unrelatedEdge],
      relationshipFacts: NO_RELATIONSHIP_FACTS,
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.some((d) => d.kind === 'relationship.retract' || d.kind === 'relationship.create')).toBe(false);
  });
});
