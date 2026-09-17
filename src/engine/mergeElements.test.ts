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
