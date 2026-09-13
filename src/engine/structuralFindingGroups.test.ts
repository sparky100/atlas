/**
 * Unit tests for src/engine/structuralFindingGroups.ts's groupStructuralFindings.
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { diffFacts } from './branch';
import { emptyHead, fold, type CommitContext } from './deltas';
import { classifyMerge, type MergeReview } from './merge';
import { groupStructuralFindings } from './structuralFindingGroups';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function createEl(id: UUID, elementId: UUID, name: string, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}
function retractEl(id: UUID, elementId: UUID, previousDeltaId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType: 'system', previousDeltaId, sourceId: 'src', confidence: 1 };
}
function updateAttr(id: UUID, elementId: UUID, attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: attribute as never, value: value as never, previousDeltaId, sourceId: 'src', confidence: 1 };
}
function createRel(id: UUID, relationshipId: UUID, relationshipType: 'uses' | 'owns', fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}
function retractRel(id: UUID, relationshipId: UUID, relationshipType: 'uses' | 'owns', previousDeltaId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function buildReview(baseDeltas: Delta[], oursExtra: Delta[], theirsExtra: Delta[]): MergeReview {
  const base = fold(emptyHead(), baseDeltas, ctx);
  const ours = fold(fold(emptyHead(), baseDeltas, ctx), oursExtra, ctx);
  const theirs = fold(fold(emptyHead(), baseDeltas, ctx), theirsExtra, ctx);
  const fields = diffFacts(base, ours, theirs);
  const classification = classifyMerge({ base, ours, theirs, fields });
  return { threeWay: { mergeBaseCommitId: 'base', base, ours, theirs, fields, upToDateWithMain: false }, classification };
}

describe('groupStructuralFindings', () => {
  it('Case A (our branch retracted, main modified): one retraction card, no pre-existing-relationship checklist', () => {
    const review = buildReview([createEl('d0', 'e', 'E')], [retractEl('d-ours', 'e', 'd0')], [updateAttr('d-theirs', 'e', 'vendor', 'Acme', 'd0')]);
    const groups = groupStructuralFindings(review);
    expect(groups.retractions).toHaveLength(1);
    expect(groups.retractions[0]).toMatchObject({ elementId: 'e', elementName: 'E', retractedSide: 'ours', keepingSide: 'theirs', preExistingRelationships: [] });
  });

  it('Case B (main retracted, our branch modified): the retraction card lists pre-existing relationships as restore candidates', () => {
    const review = buildReview(
      [createEl('d0', 'e', 'E'), createEl('d1', 'x', 'X'), createRel('d2', 'q', 'uses', 'e', 'x')],
      [updateAttr('d-ours', 'e', 'vendor', 'Acme', 'd0')],
      [retractRel('d-theirs-q', 'q', 'uses', 'd2'), retractEl('d-theirs-e', 'e', 'd0')],
    );
    const groups = groupStructuralFindings(review);
    expect(groups.retractions).toHaveLength(1);
    expect(groups.retractions[0]).toMatchObject({ elementId: 'e', retractedSide: 'theirs', keepingSide: 'ours' });
    expect(groups.retractions[0]?.preExistingRelationships).toEqual([{ relationshipId: 'q', name: 'X' }]);
  });

  it('a dangling-endpoint and a dangling-parent finding for the same retracted element land in the same card', () => {
    const review = buildReview(
      [createEl('d0', 'e', 'E'), createEl('d1', 'f', 'F'), createEl('d2', 'g', 'G')],
      [retractEl('d-ours', 'e', 'd0')],
      [createRel('d-theirs-rel', 'r', 'uses', 'f', 'e'), updateAttr('d-theirs-reparent', 'g', 'parentId', 'e', null as never)],
    );
    const groups = groupStructuralFindings(review);
    expect(groups.retractions).toHaveLength(1);
    expect(groups.retractions[0]?.elementId).toBe('e');
    expect(groups.retractions[0]?.group.danglingRelationshipIds).toEqual(new Set(['r']));
    expect(groups.retractions[0]?.group.danglingChildIds).toEqual(new Set(['g']));
  });

  it('converged-retract findings never produce a retraction card', () => {
    const review = buildReview([createEl('d0', 'e', 'E')], [retractEl('d-ours', 'e', 'd0')], [retractEl('d-theirs', 'e', 'd0')]);
    const groups = groupStructuralFindings(review);
    expect(groups.retractions).toEqual([]);
  });

  it('duplicate-relationship findings become one pair card, deduplicated', () => {
    const review = buildReview(
      [createEl('d0', 'a', 'A'), createEl('d1', 'b', 'B')],
      [createRel('d-ours', 'rel-ours', 'uses', 'a', 'b')],
      [createRel('d-theirs', 'rel-theirs', 'uses', 'a', 'b')],
    );
    const groups = groupStructuralFindings(review);
    expect(groups.duplicates).toHaveLength(1);
    expect(groups.duplicates[0]).toMatchObject({ findingClass: 'structural:duplicate-relationship', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', relationshipTypeLabel: 'uses' });
    expect(groups.cardinalities).toEqual([]);
  });
});
