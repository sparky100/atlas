/**
 * `buildMergeElementsDeltas`'s own `effect` field (E7) — the structured
 * classification `mergeEffectSentences.ts`'s preview reads directly.
 * `mergeElements.property.test.ts` already covers the deltas themselves
 * generatively (P-33); this file is the one place each `MergeRelationshipOutcome`
 * is checked by name, with a small, concrete fixture per case.
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, fold, type CommitContext, type Head } from './deltas';
import { buildMergeElementsDeltas } from './mergeElements';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const SOURCE_ID = 'merge-elements-source';
let seq = 0;
const mintId = () => `minted-${String((seq += 1))}`;

function createElement(id: UUID, elementId: UUID, elementType: string, name: string, parentId: UUID | null = null, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function createRelationship(id: UUID, relationshipId: UUID, relationshipType: string, fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function headFrom(deltas: Delta[]): Head {
  return fold(emptyHead(), deltas, ctx);
}

const SYSTEM_ATTRS = { lifecycleStatus: 'active', isExternal: false };

describe('buildMergeElementsDeltas: effect classification', () => {
  it('a plain relationship the loser owns is repointed to the survivor', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-target', 'target', 'system', 'Target', null, SYSTEM_ATTRS),
      createRelationship('d-rel', 'rel-1', 'uses', 'loser', 'target'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-1', relationshipType: 'uses', otherElementId: 'target', loserSide: 'from', outcome: 'repointed' }]);
  });

  it('an inbound relationship into the loser is repointed onto the survivor, loserSide "to"', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-other', 'other', 'system', 'Other', null, SYSTEM_ATTRS),
      createRelationship('d-rel', 'rel-1', 'uses', 'other', 'loser'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-1', relationshipType: 'uses', otherElementId: 'other', loserSide: 'to', outcome: 'repointed' }]);
  });

  it('a primary supports edge colliding with the survivor\'s own primary is repointed and demoted to secondary', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-capA', 'capA', 'capability', 'A'),
      createElement('d-capB', 'capB', 'capability', 'B'),
      createRelationship('d-sup-survivor', 'rel-survivor', 'supports', 'survivor', 'capA', { role: 'primary' }),
      createRelationship('d-sup-loser', 'rel-loser', 'supports', 'loser', 'capB', { role: 'primary' }),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-loser', relationshipType: 'supports', otherElementId: 'capB', loserSide: 'from', outcome: 'repointed-demoted-secondary' }]);
  });

  it('a relationship that would duplicate one the survivor already has is dropped', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-target', 'target', 'system', 'Target', null, SYSTEM_ATTRS),
      createRelationship('d-rel-survivor', 'rel-survivor', 'uses', 'survivor', 'target'),
      createRelationship('d-rel-loser', 'rel-loser', 'uses', 'loser', 'target'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-loser', relationshipType: 'uses', otherElementId: 'target', loserSide: 'from', outcome: 'dropped-duplicate' }]);
  });

  it('an owns edge colliding with the survivor\'s own same-role owns edge is dropped (owns has no neutral role)', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-owner1', 'owner1', 'actor', 'Owner 1', null, { subtype: 'team', isExternal: false }),
      createElement('d-owner2', 'owner2', 'actor', 'Owner 2', null, { subtype: 'team', isExternal: false }),
      createRelationship('d-owns-survivor', 'rel-survivor', 'owns', 'owner1', 'survivor', { role: 'business' }),
      createRelationship('d-owns-loser', 'rel-loser', 'owns', 'owner2', 'loser', { role: 'business' }),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-loser', relationshipType: 'owns', otherElementId: 'owner2', loserSide: 'to', outcome: 'dropped-cardinality' }]);
  });

  it('a relationship directly between the loser and the survivor is dropped as a self-loop', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createRelationship('d-rel', 'rel-1', 'uses', 'loser', 'survivor'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-1', relationshipType: 'uses', otherElementId: 'survivor', loserSide: 'from', outcome: 'dropped-self-loop' }]);
  });

  it('lists every child of the loser as reparented', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-child1', 'child1', 'container', 'Child 1', 'loser'),
      createElement('d-child2', 'child2', 'container', 'Child 2', 'loser'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.reparentedChildIds.sort()).toEqual(['child1', 'child2']);
    expect(effect.relationships).toEqual([]);
  });

  it('reports no effect at all when the loser has no relationships or children', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect).toEqual({ relationships: [], reparentedChildIds: [] });
  });
});

/**
 * ADR-001 amendment ("replaces") — `buildMergeElementsDeltas` needed zero
 * production changes for the new type: retract/self-loop-drop/duplicate-
 * drop/repoint are already generic over `relationshipType`, and because
 * `replaces` has no cardinality cap (`RELATIONSHIP_TYPE_RULES`'s own
 * `maxPrimaryPerFrom`/`maxPrimaryPerTo: null` rows), the one type-specific
 * branch in this file (the `supports`/`owns` primary-collision special
 * case) is never reached for it. This proves that rather than asserting
 * it: every case below is the exact `replaces` analogue of an existing
 * `supports`/`owns`/`uses` case above, plus one case that would trip the
 * `supports`-style collision branch if the type check above it were ever
 * loosened.
 */
describe('buildMergeElementsDeltas: replaces edges', () => {
  it('a replaces edge into the retiring element ("to" side) is repointed onto the survivor', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-replacement', 'replacement', 'system', 'Replacement', null, SYSTEM_ATTRS),
      createRelationship('d-rel', 'rel-1', 'replaces', 'replacement', 'loser'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-1', relationshipType: 'replaces', otherElementId: 'replacement', loserSide: 'to', outcome: 'repointed' }]);
  });

  it('a replaces edge from the retiring replacement ("from" side) is repointed onto the survivor', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-retiring', 'retiring', 'system', 'Retiring', null, SYSTEM_ATTRS),
      createRelationship('d-rel', 'rel-1', 'replaces', 'loser', 'retiring'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-1', relationshipType: 'replaces', otherElementId: 'retiring', loserSide: 'from', outcome: 'repointed' }]);
  });

  it('merging a retiring element into its own replacement drops the replaces edge as a self-loop', () => {
    const head = headFrom([
      createElement('d-replacement', 'replacement', 'system', 'Replacement', null, SYSTEM_ATTRS),
      createElement('d-retiring', 'retiring', 'system', 'Retiring', null, SYSTEM_ATTRS),
      createRelationship('d-rel', 'rel-1', 'replaces', 'replacement', 'retiring'),
    ]);
    // survivor = the replacement, loser = the retiring element it already replaces.
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'replacement', 'retiring', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-1', relationshipType: 'replaces', otherElementId: 'replacement', loserSide: 'to', outcome: 'dropped-self-loop' }]);
  });

  it('a replaces edge that would duplicate one the survivor already has is dropped', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-target', 'target', 'system', 'Target', null, SYSTEM_ATTRS),
      createRelationship('d-rel-survivor', 'rel-survivor', 'replaces', 'survivor', 'target'),
      createRelationship('d-rel-loser', 'rel-loser', 'replaces', 'loser', 'target'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-loser', relationshipType: 'replaces', otherElementId: 'target', loserSide: 'from', outcome: 'dropped-duplicate' }]);
  });

  it('consolidation: two independently-retired elements sharing one replacement both repoint cleanly when the replacement itself merges into another element', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-retiring1', 'retiring1', 'system', 'Retiring 1', null, SYSTEM_ATTRS),
      createElement('d-retiring2', 'retiring2', 'system', 'Retiring 2', null, SYSTEM_ATTRS),
      createRelationship('d-rel1', 'rel-1', 'replaces', 'loser', 'retiring1'),
      createRelationship('d-rel2', 'rel-2', 'replaces', 'loser', 'retiring2'),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([
      { relationshipId: 'rel-1', relationshipType: 'replaces', otherElementId: 'retiring1', loserSide: 'from', outcome: 'repointed' },
      { relationshipId: 'rel-2', relationshipType: 'replaces', otherElementId: 'retiring2', loserSide: 'from', outcome: 'repointed' },
    ]);
  });

  it('never invokes the supports/owns-only cardinality-collision branch, even when a replaces edge carries a role-shaped attribute that would trip it for those types', () => {
    const head = headFrom([
      createElement('d-survivor', 'survivor', 'system', 'Survivor', null, SYSTEM_ATTRS),
      createElement('d-loser', 'loser', 'system', 'Loser', null, SYSTEM_ATTRS),
      createElement('d-target1', 'target1', 'system', 'Target 1', null, SYSTEM_ATTRS),
      createElement('d-target2', 'target2', 'system', 'Target 2', null, SYSTEM_ATTRS),
      // Neither ReplacesAttributes nor RELATIONSHIP_TYPE_RULES defines a
      // `role` for `replaces` — this attribute is deliberately malformed
      // input, present only to prove the merge engine's `supports`/`owns`
      // branches are gated on `relationshipType`, not on the shape of
      // `attributes`, and so never fire for `replaces` regardless.
      createRelationship('d-rel-survivor', 'rel-survivor', 'replaces', 'survivor', 'target1', { role: 'primary' }),
      createRelationship('d-rel-loser', 'rel-loser', 'replaces', 'loser', 'target2', { role: 'primary' }),
    ]);
    const { effect } = buildMergeElementsDeltas(cloneHead(head), 'survivor', 'loser', SOURCE_ID, mintId);
    expect(effect.relationships).toEqual([{ relationshipId: 'rel-loser', relationshipType: 'replaces', otherElementId: 'target2', loserSide: 'from', outcome: 'repointed' }]);
  });
});
