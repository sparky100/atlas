import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { emptyHead, type ElementRow, type Head } from '../../engine/deltas';
import { computeVersionDiff } from '../../engine/versionDiff';
import { computeAlsoAffected } from './alsoAffected';

function withElement(head: Head, id: string, row: ElementRow): Head {
  head.elements.set(id, row);
  return head;
}

function elementRow(id: string, type: ElementsHeadRow['element_type'], name: string): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes: {}, exists_delta_id: 'd1' };
}

function ownsEdge(id: string, actorId: string, targetId: string, role: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'owns', from_element_id: actorId, to_element_id: targetId, attributes: { role }, exists_delta_id: 'd2' };
}

describe('computeAlsoAffected', () => {
  it('excludes a touched element that is a declared concern', () => {
    const row: ElementRow = { elementType: 'system', name: 'Touched', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const diff = computeVersionDiff(emptyHead(), withElement(emptyHead(), 'sys1', row));
    const result = computeAlsoAffected(diff, new Set(['sys1']), [], new Map([['sys1', elementRow('sys1', 'system', 'Touched')]]));
    expect(result).toEqual([]);
  });

  it('includes a touched element not among the declared concerns, with its owners grouped by role', () => {
    const row: ElementRow = { elementType: 'system', name: 'Touched', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const diff = computeVersionDiff(emptyHead(), withElement(emptyHead(), 'sys1', row));
    const elementsById = new Map([
      ['sys1', elementRow('sys1', 'system', 'Touched')],
      ['owner1', elementRow('owner1', 'actor', 'Ops Team')],
    ]);
    const result = computeAlsoAffected(diff, new Set(), [ownsEdge('o1', 'owner1', 'sys1', 'business')], elementsById);
    expect(result).toHaveLength(1);
    expect(result[0]?.element.name).toBe('Touched');
    expect(result[0]?.ownersByRole.get('business')?.[0]?.name).toBe('Ops Team');
  });

  it('excludes an element the diff reports unchanged', () => {
    const row: ElementRow = { elementType: 'system', name: 'Same', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const diff = computeVersionDiff(withElement(emptyHead(), 'sys1', row), withElement(emptyHead(), 'sys1', row));
    const result = computeAlsoAffected(diff, new Set(), [], new Map([['sys1', elementRow('sys1', 'system', 'Same')]]));
    expect(result).toEqual([]);
  });

  it('resolves a removed (retired) element via the merged main-side elementsById the caller passes', () => {
    const row: ElementRow = { elementType: 'system', name: 'Retired One', parentId: null, attributes: {}, existsDeltaId: 'd1' };
    const diff = computeVersionDiff(withElement(emptyHead(), 'sys1', row), emptyHead());
    // The option's own elementsById no longer has sys1 — only main's side does; the caller merges before calling.
    const merged = new Map([['sys1', elementRow('sys1', 'system', 'Retired One')]]);
    const result = computeAlsoAffected(diff, new Set(), [], merged);
    expect(result).toHaveLength(1);
    expect(result[0]?.element.name).toBe('Retired One');
  });
});
