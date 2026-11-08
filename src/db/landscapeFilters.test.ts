import { describe, expect, it } from 'vitest';
import type { RelationshipsHeadRow } from '../contracts/rows';
import { filterLandscapeEdges, filterOwnsEdgesForSystems, filterSupportsEdgesForSystems } from './landscape';

function edge(from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: `${from}>${to}`, relationship_type: 'uses', from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: 'd' } as unknown as RelationshipsHeadRow;
}

describe('landscape edge filters (the in-memory half of the parallel read)', () => {
  const rows = [edge('a', 'b'), edge('a', 'x'), edge('actor', 'a'), edge('y', 'b')];

  it('keeps edges between known systems, and from known actors', () => {
    expect(filterLandscapeEdges(rows, ['a', 'b'], ['actor']).map((r) => r.relationship_id)).toEqual(['a>b', 'actor>a']);
  });

  it('returns nothing when there are no systems, even with actors', () => {
    expect(filterLandscapeEdges(rows, [], ['actor'])).toEqual([]);
    expect(filterSupportsEdgesForSystems(rows, [])).toEqual([]);
    expect(filterOwnsEdgesForSystems(rows, [])).toEqual([]);
  });

  it('filters supports by source system and owns by target system', () => {
    expect(filterSupportsEdgesForSystems(rows, ['y']).map((r) => r.relationship_id)).toEqual(['y>b']);
    expect(filterOwnsEdgesForSystems(rows, ['a']).map((r) => r.relationship_id)).toEqual(['actor>a']);
  });
});
