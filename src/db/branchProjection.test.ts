import { describe, expect, it } from 'vitest';
import { emptyHead, type ElementRow } from '../engine/deltas';
import type { HeadProjection } from '../engine/projection';
import {
  projectionChildrenOf,
  projectionElementById,
  projectionElementsByIds,
  projectionLandscapeEdges,
  projectionRelationshipsForElement,
  projectionRelationshipsTouchingAny,
  projectionSupportsEdgesForSystems,
  projectionSystemsForLandscape,
  selectBranchModeHead,
} from './branchProjection';

function system(name: string): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes: {}, existsDeltaId: `create-${name}` };
}

function projection(): HeadProjection {
  return {
    elementsHead: [
      { element_id: 'cap-1', element_type: 'capability', name: 'Housing', parent_id: null, attributes: {}, exists_delta_id: 'd1' },
      { element_id: 'sys-b', element_type: 'system', name: 'Beta', parent_id: null, attributes: {}, exists_delta_id: 'd2' },
      { element_id: 'sys-a', element_type: 'system', name: 'Alpha', parent_id: null, attributes: {}, exists_delta_id: 'd3' },
      { element_id: 'actor-1', element_type: 'actor', name: 'Resident', parent_id: null, attributes: {}, exists_delta_id: 'd4' },
      { element_id: 'container-1', element_type: 'container', name: 'API', parent_id: 'sys-a', attributes: {}, exists_delta_id: 'd5' },
      { element_id: 'container-2', element_type: 'container', name: 'Web', parent_id: 'sys-a', attributes: {}, exists_delta_id: 'd6' },
    ],
    relationshipsHead: [
      { relationship_id: 'rel-uses', relationship_type: 'uses', from_element_id: 'sys-a', to_element_id: 'sys-b', attributes: {}, exists_delta_id: 'd7' },
      { relationship_id: 'rel-supports', relationship_type: 'supports', from_element_id: 'sys-a', to_element_id: 'cap-1', attributes: {}, exists_delta_id: 'd8' },
      { relationship_id: 'rel-external', relationship_type: 'uses', from_element_id: 'sys-a', to_element_id: 'actor-1', attributes: {}, exists_delta_id: 'd9' },
    ],
    facts: [],
  };
}

describe('branchProjection: in-memory equivalents of the elements_head/relationships_head queries', () => {
  it('projectionElementById finds by id, or returns null (getElementHead equivalent)', () => {
    expect(projectionElementById(projection(), 'sys-a')?.name).toBe('Alpha');
    expect(projectionElementById(projection(), 'missing')).toBeNull();
  });

  it('projectionElementsByIds batches a lookup (getElementsByIds equivalent)', () => {
    const result = projectionElementsByIds(projection(), ['sys-a', 'actor-1', 'missing']);
    expect([...result.keys()].sort()).toEqual(['actor-1', 'sys-a']);
  });

  it('projectionChildrenOf filters by parent_id, name-sorted (listChildrenOf equivalent)', () => {
    const children = projectionChildrenOf(projection(), 'sys-a');
    expect(children.map((c) => c.name)).toEqual(['API', 'Web']);
  });

  it('projectionRelationshipsForElement returns both directions (listRelationshipsForElement equivalent)', () => {
    const rels = projectionRelationshipsForElement(projection(), 'sys-b');
    expect(rels.map((r) => r.relationship_id)).toEqual(['rel-uses']);
  });

  it('projectionSystemsForLandscape returns only systems, name-sorted (listSystemsForLandscape equivalent)', () => {
    expect(projectionSystemsForLandscape(projection()).map((s) => s.name)).toEqual(['Alpha', 'Beta']);
  });

  it('projectionLandscapeEdges requires both endpoints in the given set and uses/flows_to only (listLandscapeEdges equivalent)', () => {
    const edges = projectionLandscapeEdges(projection(), ['sys-a', 'sys-b']);
    expect(edges.map((e) => e.relationship_id)).toEqual(['rel-uses']);
    // sys-a -> actor-1 is `uses` but actor-1 isn't in the system set — excluded, matching "both endpoints" semantics.
    expect(projectionLandscapeEdges(projection(), ['sys-a']).length).toBe(0);
  });

  it('projectionSupportsEdgesForSystems returns only `supports` edges from the given systems (listSupportsEdgesForSystems equivalent)', () => {
    const edges = projectionSupportsEdgesForSystems(projection(), ['sys-a']);
    expect(edges.map((e) => e.relationship_id)).toEqual(['rel-supports']);
  });

  it('projectionRelationshipsTouchingAny matches either endpoint, filtered by type (listRelationshipsTouchingAny equivalent)', () => {
    const touching = projectionRelationshipsTouchingAny(projection(), ['actor-1'], ['uses']);
    expect(touching.map((r) => r.relationship_id)).toEqual(['rel-external']);
    expect(projectionRelationshipsTouchingAny(projection(), ['actor-1'], ['supports']).length).toBe(0);
  });
});

describe('selectBranchModeHead: the As-is/To-be/Diff selector\'s pure core (§6.2/§6.3)', () => {
  // as-is has 'kept' (unchanged) and 'gone' (removed in to-be); to-be adds 'added' and keeps 'kept' renamed.
  function heads() {
    const asIs = emptyHead();
    asIs.elements.set('kept', system('Kept'));
    asIs.elements.set('gone', system('Gone'));

    const toBe = emptyHead();
    toBe.elements.set('kept', { ...system('Kept Renamed'), existsDeltaId: 'create-Kept' });
    toBe.elements.set('added', system('Added'));

    return { asIs, toBe };
  }

  it('asIs mode returns the as-is Head verbatim, with no diff', () => {
    const { asIs, toBe } = heads();
    const result = selectBranchModeHead(asIs, 'base-commit', toBe, 'head-commit', 'asIs');
    expect(result).toMatchObject({ commitId: 'base-commit', diff: null });
    expect([...result.head.elements.keys()].sort()).toEqual(['gone', 'kept']);
  });

  it('toBe mode returns the to-be Head verbatim, with no diff', () => {
    const { asIs, toBe } = heads();
    const result = selectBranchModeHead(asIs, 'base-commit', toBe, 'head-commit', 'toBe');
    expect(result).toMatchObject({ commitId: 'head-commit', diff: null });
    expect([...result.head.elements.keys()].sort()).toEqual(['added', 'kept']);
  });

  it('diff mode renders at the to-be commit, with removed elements ghosted back in and a diff classifying every id', () => {
    const { asIs, toBe } = heads();
    const result = selectBranchModeHead(asIs, 'base-commit', toBe, 'head-commit', 'diff');
    expect(result.commitId).toBe('head-commit');
    // 'gone' is back in the render Head (ghosted) even though it's absent from to-be.
    expect([...result.head.elements.keys()].sort()).toEqual(['added', 'gone', 'kept']);
    expect(result.head.elements.get('gone')).toEqual(asIs.elements.get('gone'));

    const stateById = new Map(result.diff?.elements.map((e) => [e.elementId, e.state]));
    expect(stateById.get('kept')).toBe('changed');
    expect(stateById.get('gone')).toBe('removed');
    expect(stateById.get('added')).toBe('added');
  });
});
