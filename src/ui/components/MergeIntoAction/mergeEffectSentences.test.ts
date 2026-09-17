import { describe, expect, it } from 'vitest';
import type { MergeEffect } from '../../../engine/mergeElements';
import { mergeReparentEffectSentences, mergeRelationshipEffectSentences } from './mergeEffectSentences';

const NAMES: Record<string, string> = { target: 'Target', capB: 'Capability B', child1: 'Child One' };
const nameOf = (id: string) => NAMES[id] ?? id;

describe('mergeRelationshipEffectSentences', () => {
  it('describes an outbound repoint with the outbound verb', () => {
    const effect: MergeEffect = { relationships: [{ relationshipId: 'r1', relationshipType: 'uses', otherElementId: 'target', loserSide: 'from', outcome: 'repointed' }], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual(['Survivor uses Target (re-pointed from Loser).']);
  });

  it('describes an inbound repoint with the inbound verb', () => {
    const effect: MergeEffect = { relationships: [{ relationshipId: 'r1', relationshipType: 'uses', otherElementId: 'target', loserSide: 'to', outcome: 'repointed' }], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual(['Survivor used by Target (re-pointed from Loser).']);
  });

  it('names the demotion to secondary explicitly', () => {
    const effect: MergeEffect = { relationships: [{ relationshipId: 'r1', relationshipType: 'supports', otherElementId: 'capB', loserSide: 'from', outcome: 'repointed-demoted-secondary' }], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual(['Survivor supports Capability B (re-pointed from Loser, demoted to secondary — Survivor already has a primary here).']);
  });

  it('explains a dropped duplicate by naming the survivor already has it', () => {
    const effect: MergeEffect = { relationships: [{ relationshipId: 'r1', relationshipType: 'uses', otherElementId: 'target', loserSide: 'from', outcome: 'dropped-duplicate' }], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual(['Loser uses Target is dropped — Survivor already has this relationship.']);
  });

  it('explains a dropped cardinality collision', () => {
    const effect: MergeEffect = { relationships: [{ relationshipId: 'r1', relationshipType: 'owns', otherElementId: 'target', loserSide: 'to', outcome: 'dropped-cardinality' }], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual(['Loser owned by Target is dropped — Survivor already owns it in that role.']);
  });

  it('explains a dropped self-loop', () => {
    const effect: MergeEffect = { relationships: [{ relationshipId: 'r1', relationshipType: 'uses', otherElementId: 'target', loserSide: 'from', outcome: 'dropped-self-loop' }], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual(['Loser uses Target is dropped — merging the two would make it a relationship to itself.']);
  });

  it('produces one sentence per relationship, in order', () => {
    const effect: MergeEffect = {
      relationships: [
        { relationshipId: 'r1', relationshipType: 'uses', otherElementId: 'target', loserSide: 'from', outcome: 'repointed' },
        { relationshipId: 'r2', relationshipType: 'supports', otherElementId: 'capB', loserSide: 'from', outcome: 'dropped-duplicate' },
      ],
      reparentedChildIds: [],
    };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toHaveLength(2);
  });

  it('is an empty list when the merge touches no relationships', () => {
    const effect: MergeEffect = { relationships: [], reparentedChildIds: [] };
    expect(mergeRelationshipEffectSentences(effect, 'Survivor', 'Loser', nameOf)).toEqual([]);
  });
});

describe('mergeReparentEffectSentences', () => {
  it('describes each reparented child moving under the survivor', () => {
    const effect: MergeEffect = { relationships: [], reparentedChildIds: ['child1'] };
    expect(mergeReparentEffectSentences(effect, 'Survivor', nameOf)).toEqual(['Child One moves under Survivor.']);
  });

  it('is an empty list when the loser has no children', () => {
    const effect: MergeEffect = { relationships: [], reparentedChildIds: [] };
    expect(mergeReparentEffectSentences(effect, 'Survivor', nameOf)).toEqual([]);
  });
});
