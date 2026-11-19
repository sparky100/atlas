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

describe('buildReplaceWithNewElementDeltas', () => {
  it('creates the new element and retires the old one, with no relationships to transfer', () => {
    const a = system('a', 'Old System');
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [],
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.map((d) => d.kind)).toEqual(['element.create', 'element.update', 'element.update', 'relationship.create']);
    const create = deltas[0] as { elementId: string; elementType: string; name: string; parentId: string | null };
    expect(create.elementId).toBe(newElementId);
    expect(create.elementType).toBe('system');
    expect(create.name).toBe('New System');
    expect(create.parentId).toBeNull();

    // ADR-001 amendment: a `replaces` edge from the new element to the old
    // one is written every time, even with nothing else to transfer.
    const replaces = deltas[3] as unknown as { relationshipType: string; fromElementId: string; toElementId: string; attributes: Record<string, unknown> };
    expect(replaces.relationshipType).toBe('replaces');
    expect(replaces.fromElementId).toBe(newElementId);
    expect(replaces.toElementId).toBe('a');
    expect(replaces.attributes).toEqual({});
  });

  it('skips the lifecycleStatus delta when the element is already retiring', () => {
    const a = { ...system('a', 'Old System'), attributes: { lifecycleStatus: 'retiring' } };
    const { deltas } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [],
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.map((d) => d.kind)).toEqual(['element.create', 'element.update', 'relationship.create']);
    expect((deltas[1] as { attribute: string }).attribute).toBe('plannedEnd');
  });

  it('a container replacement inherits the old container\'s own parent', () => {
    const a = container('a', 'PM', 'platform-1');
    const { deltas } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [],
      plannedEnd: '2027-01-01',
      replacementName: 'New PM',
      sourceId: 'src',
      onMain: true,
    });

    expect((deltas[0] as { parentId: string | null }).parentId).toBe('platform-1');
  });

  it('copies a supports edge to the new element as secondary, carrying its description, and keeps the old one', () => {
    const a = system('a', 'Old System');
    const supportsEdge = rel('r1', 'supports', 'a', 'cap-1', { role: 'primary', description: 'the main one' });
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [supportsEdge],
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    // Copy, never move: A keeps its own supports link.
    expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(false);

    const created = deltas.find((d) => d.kind === 'relationship.create' && (d as unknown as { relationshipType: string }).relationshipType === 'supports') as unknown as {
      fromElementId: string;
      toElementId: string;
      attributes: Record<string, unknown>;
    };
    expect(created.fromElementId).toBe(newElementId);
    expect(created.toElementId).toBe('cap-1');
    expect(created.attributes).toEqual({ role: 'secondary', description: 'the main one' });
  });

  it('copies uses and flows_to links with their direction and attributes, and leaves the old links in place', () => {
    const a = system('a', 'Old System');
    const usesEdge = rel('r2', 'uses', 'a', 'other-system', { description: 'looks up prices' });
    const flowsEdge = rel('r3', 'flows_to', 'other-system', 'a', { description: 'sends readings to' });
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [usesEdge, flowsEdge],
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(false);
    const creates = deltas.filter((d) => d.kind === 'relationship.create') as unknown as { relationshipType: string; fromElementId: string; toElementId: string; attributes: Record<string, unknown> }[];
    const uses = creates.find((d) => d.relationshipType === 'uses');
    const flows = creates.find((d) => d.relationshipType === 'flows_to');
    expect(uses).toMatchObject({ fromElementId: newElementId, toElementId: 'other-system', attributes: { description: 'looks up prices' } });
    expect(flows).toMatchObject({ fromElementId: 'other-system', toElementId: newElementId, attributes: { description: 'sends readings to' } });
    expect(creates.map((d) => d.relationshipType).sort()).toEqual(['flows_to', 'replaces', 'uses']);
  });

  it('copies only the links left ticked', () => {
    const a = system('a', 'Old System');
    const usesEdge = rel('r2', 'uses', 'a', 'other-system');
    const capEdge = rel('r1', 'supports', 'a', 'cap-1');
    const { deltas } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [usesEdge, capEdge],
      copyEdgeIds: new Set(['r1']),
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });
    const types = (deltas.filter((d) => d.kind === 'relationship.create') as unknown as { relationshipType: string }[]).map((d) => d.relationshipType).sort();
    expect(types).toEqual(['replaces', 'supports']);
  });

  it('never transfers an owns edge, or a relationship where A is neither endpoint — the only relationship.create is the replaces edge', () => {
    const a = system('a', 'Old System');
    const ownsEdge = rel('r4', 'owns', 'actor-1', 'a', { role: 'business' });
    const unrelatedEdge = rel('r5', 'uses', 'x', 'y');
    const { deltas, newElementId } = buildReplaceWithNewElementDeltas({
      element: a,
      facts: NO_FACTS,
      relationships: [ownsEdge, unrelatedEdge],
      plannedEnd: '2027-01-01',
      replacementName: 'New System',
      sourceId: 'src',
      onMain: true,
    });

    expect(deltas.some((d) => d.kind === 'relationship.retract')).toBe(false);
    const relationshipCreates = deltas.filter((d) => d.kind === 'relationship.create') as unknown as { relationshipType: string; fromElementId: string; toElementId: string }[];
    expect(relationshipCreates).toHaveLength(1);
    expect(relationshipCreates[0]?.relationshipType).toBe('replaces');
    expect(relationshipCreates[0]?.fromElementId).toBe(newElementId);
    expect(relationshipCreates[0]?.toElementId).toBe('a');
  });
});
