import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { contextInspectorFocusedNeighbour } from './contextInspectorSelection';
import type { ContextGroup } from './contextGrouping';

function element(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function edge(id: string, from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'uses', from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

function group(): ContextGroup {
  const hub = element('hub', 'Hub');
  const internalNeighbour = element('n1', 'Internal Neighbour');
  const externalNeighbour = element('n2', 'External Neighbour');
  return {
    hub,
    hubDisplayName: hub.name,
    internal: [{ element: internalNeighbour, edges: [edge('e1', 'hub', 'n1')], displayName: internalNeighbour.name }],
    external: [{ element: externalNeighbour, edges: [edge('e2', 'n2', 'hub')], displayName: externalNeighbour.name }],
    owners: [],
    supports: [],
  };
}

describe('contextInspectorFocusedNeighbour', () => {
  it('returns null when nothing is focused', () => {
    expect(contextInspectorFocusedNeighbour(null, group())).toBeNull();
  });

  it('finds an internal neighbour by id', () => {
    const result = contextInspectorFocusedNeighbour('n1', group());
    expect(result?.element.name).toBe('Internal Neighbour');
  });

  it('finds an external neighbour by id', () => {
    const result = contextInspectorFocusedNeighbour('n2', group());
    expect(result?.element.name).toBe('External Neighbour');
  });

  it('returns null for the hub itself — the hub never enters focus', () => {
    expect(contextInspectorFocusedNeighbour('hub', group())).toBeNull();
  });

  it('returns null for an id that names no neighbour of this hub (stale focus after a reload)', () => {
    expect(contextInspectorFocusedNeighbour('gone', group())).toBeNull();
  });
});
