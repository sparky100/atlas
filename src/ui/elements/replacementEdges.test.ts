import { describe, expect, it } from 'vitest';
import type { Json } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { buildCopiedEdgeDeltas, listCopyableEdges } from './replacementEdges';

const rel = (id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow => ({ relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes, exists_delta_id: `d-${id}` });
const names: Record<string, string> = { cap: 'Housing Repairs', gw: 'Billing Gateway', crm: 'CRM' };

describe('listCopyableEdges', () => {
  it('names each link by its other end, in plain words, and skips owns', () => {
    const edges = [rel('1', 'supports', 'a', 'cap'), rel('2', 'flows_to', 'a', 'gw'), rel('3', 'flows_to', 'crm', 'a'), rel('4', 'uses', 'crm', 'a'), rel('5', 'owns', 'x', 'a')];
    const list = listCopyableEdges('a', edges, (id) => names[id]);
    expect(list.map((e) => e.label)).toEqual(['Supports Housing Repairs', 'Sends data to Billing Gateway', 'Receives data from CRM', 'Used by CRM']);
    expect(list.map((e) => e.kind)).toEqual(['capability', 'interface', 'interface', 'interface']);
  });
});

describe('buildCopiedEdgeDeltas', () => {
  it('skips a link the replacement already has, one to itself, and anything unticked', () => {
    const edges = [rel('1', 'uses', 'a', 'gw'), rel('2', 'uses', 'a', 'crm'), rel('3', 'uses', 'a', 'b'), rel('4', 'uses', 'a', 'cap')];
    const deltas = buildCopiedEdgeDeltas({ oldId: 'a', newId: 'b', relationships: edges, chosen: new Set(['1', '2', '3']), alreadyThere: new Set(['uses|b|crm']), sourceId: 's' });
    const to = (deltas as unknown as { toElementId: string }[]).map((d) => d.toElementId);
    expect(to).toEqual(['gw']);
  });
});
