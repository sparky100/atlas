/**
 * Unit tests for src/engine/mergeResolution.ts's buildStructuralResolutions
 * (ADR-021 §3.3, §4 — C2b) and unresolvedStructuralFindings (C15, amended).
 *
 * Each "golden" test asserts the exact delta kinds/order/previousDeltaId
 * links per ADR-021 §4; each scenario also has an end-to-end replay test
 * confirming `cloneHead(ours) ⊕ prepDeltas ⊕ replay(X) ⊕ mergeDeltas` never
 * throws and lands on the expected final state — the actual property ADR-021
 * §3.3's table exists to guarantee (P-29 does this generatively; these do it
 * for the specific named shapes, including the issue's own original failing
 * scenario).
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { classifyMerge, type MergeReview } from './merge';
import { diffFacts } from './branch';
import { cloneHead, emptyHead, fold, type CommitContext, type Head } from './deltas';
import {
  buildStructuralResolutions,
  unresolvedStructuralFindings,
  type CardinalityChoice,
  type DuplicateRelationshipChoice,
  type RetractionChoice,
  type StructuralChoice,
} from './mergeResolution';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function createEl(id: UUID, elementId: UUID, name: string, attributes: Record<string, unknown> = { lifecycleStatus: 'active', isExternal: false }, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}

function createCapability(id: UUID, elementId: UUID, name: string, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'capability', name, parentId, attributes: {}, sourceId: 'src', confidence: 1 };
}

function createActor(id: UUID, elementId: UUID, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'actor', name, parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function updateAttr(id: UUID, elementId: UUID, attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: attribute as never, value: value as never, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function retractEl(id: UUID, elementId: UUID, previousDeltaId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType: 'system', previousDeltaId, sourceId: 'src', confidence: 1 };
}

function createRel(
  id: UUID,
  relationshipId: UUID,
  relationshipType: 'uses' | 'owns' | 'flows_to' | 'supports',
  fromElementId: UUID,
  toElementId: UUID,
  attributes: Record<string, unknown> = {},
): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}

function retractRel(id: UUID, relationshipId: UUID, relationshipType: 'uses' | 'owns' | 'flows_to' | 'supports', previousDeltaId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId: 'src', confidence: 1 };
}

/** Folds baseDeltas alone for `base`, plus oursExtra/theirsExtra for `ours`/`theirs`, and assembles the MergeReview buildStructuralResolutions takes — mirrors merge.test.ts's own `scenario` shape. */
function scenario(baseDeltas: Delta[], oursExtra: Delta[], theirsExtra: Delta[]): { review: MergeReview; ours: Head; theirsExtra: Delta[] } {
  const base: Head = fold(emptyHead(), baseDeltas, ctx);
  const ours: Head = fold(fold(emptyHead(), baseDeltas, ctx), oursExtra, ctx);
  const theirs: Head = fold(fold(emptyHead(), baseDeltas, ctx), theirsExtra, ctx);
  const fields = diffFacts(base, ours, theirs);
  const classification = classifyMerge({ base, ours, theirs, fields });
  const review: MergeReview = { threeWay: { mergeBaseCommitId: 'base', base, ours, theirs, fields, upToDateWithMain: theirsExtra.length === 0 }, classification };
  return { review, ours, theirsExtra };
}

function idMinter(prefix: string): () => UUID {
  let i = 0;
  return () => {
    i += 1;
    return `${prefix}-${String(i)}`;
  };
}

/** Replays `cloneHead(ours) ⊕ prepDeltas ⊕ X ⊕ mergeDeltas` — the real fold every refresh actually does — and returns the resulting head, throwing if any step is invalid. */
function replay(ours: Head, prepDeltas: Delta[], theirsExtra: Delta[], mergeDeltas: Delta[]): Head {
  const head = cloneHead(ours);
  fold(head, prepDeltas, ctx);
  fold(head, theirsExtra, ctx);
  fold(head, mergeDeltas, ctx);
  return head;
}

describe('structural: retract-vs-modify (Case A: our own branch retracted E, main modified it)', () => {
  it('keep-retraction: P restores E, M retracts it again after replay — the issue\'s own original failing scenario, now resolved', () => {
    const { review, ours, theirsExtra } = scenario([createEl('d0', 'e', 'X')], [retractEl('d-ours-retract', 'e', 'd0')], [updateAttr('d-theirs-update', 'e', 'vendor', 'Acme', 'd0')]);
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action: 'keep-retraction' }];
    const mintId = idMinter('m');
    const result = buildStructuralResolutions(review, choices, 'merge-resolution-source', mintId);

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'element.restore', id: 'm-1', elementId: 'e', previousDeltaId: 'd-ours-retract' })]);
    expect(result.mergeDeltas).toEqual([expect.objectContaining({ kind: 'element.retract', id: 'm-2', elementId: 'e', previousDeltaId: 'm-1' })]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-ours-retract', discardedDeltaId: 'd-theirs-update', resolutionDeltaId: 'm-2', rationale: 'keep-retraction' }]);

    // The failing scenario, resolved: replaying our own retract, main's exclusive update, and this resolution never throws.
    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.elements.has('e')).toBe(false);
  });

  it('keep-element: P restores E, M has no own deltas, main\'s update lands on the restored element', () => {
    const { review, ours, theirsExtra } = scenario([createEl('d0', 'e', 'X')], [retractEl('d-ours-retract', 'e', 'd0')], [updateAttr('d-theirs-update', 'e', 'vendor', 'Acme', 'd0')]);
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action: 'keep-element' }];
    const mintId = idMinter('m');
    const result = buildStructuralResolutions(review, choices, 'src', mintId);

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'element.restore', id: 'm-1', elementId: 'e', previousDeltaId: 'd-ours-retract' })]);
    expect(result.mergeDeltas).toEqual([]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-theirs-update', discardedDeltaId: 'd-ours-retract', resolutionDeltaId: 'm-1', rationale: 'keep-element' }]);

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.elements.get('e')?.attributes.vendor).toBe('Acme');
  });

  it('keep-retraction with a dangling-endpoint and a dangling-parent cascades: relationship retracted, child re-parented, in order, before the final retract', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'e', 'E'), createEl('d1', 'f', 'F'), createEl('d2', 'g', 'G')],
      [retractEl('d-ours-retract', 'e', 'd0')],
      [createRel('d-theirs-rel', 'r', 'uses', 'f', 'e'), updateAttr('d-theirs-reparent', 'g', 'parentId', 'e', null as never)],
    );
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action: 'keep-retraction' }];
    const mintId = idMinter('m');
    const result = buildStructuralResolutions(review, choices, 'src', mintId);

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'element.restore', elementId: 'e' })]);
    expect(result.mergeDeltas.map((d) => d.kind)).toEqual(['relationship.retract', 'element.update', 'element.retract']);
    expect(result.mergeDeltas[1]).toEqual(expect.objectContaining({ attribute: 'parentId', value: null }));

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.elements.has('e')).toBe(false);
    expect(finalHead.relationships.has('r')).toBe(false);
    expect(finalHead.elements.get('g')?.parentId).toBe(null);
  });
});

describe('structural: retract-vs-modify (Case B: main retracted E, our own branch modified it)', () => {
  it('keep-element: pre-existing relationship Q and our own new relationship S both restored, in order, after E itself', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'e', 'E'), createEl('d1', 'x', 'X'), createEl('d2', 'y', 'Y'), createRel('d3', 'q', 'uses', 'e', 'x')],
      [updateAttr('d-ours-update', 'e', 'vendor', 'Acme', 'd0'), createRel('d-ours-rel', 's', 'uses', 'y', 'e')],
      [retractRel('d-theirs-retract-q', 'q', 'uses', 'd3'), retractEl('d-theirs-retract-e', 'e', 'd0')],
    );
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action: 'keep-element' }];
    const mintId = idMinter('m');
    const result = buildStructuralResolutions(review, choices, 'src', mintId);

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'relationship.retract', relationshipId: 's' })]);
    expect(result.mergeDeltas.map((d) => d.kind)).toEqual(['element.restore', 'relationship.restore', 'relationship.restore']);
    expect(result.mergeDeltas[0]).toEqual(expect.objectContaining({ elementId: 'e', previousDeltaId: 'd-theirs-retract-e' }));
    expect(result.resolvedConflicts).toHaveLength(3); // one for e's own field, one for s, one for q

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.elements.get('e')?.attributes.vendor).toBe('Acme'); // restored with our own provenance/value
    expect(finalHead.relationships.has('s')).toBe(true);
    expect(finalHead.relationships.has('q')).toBe(true);
  });

  it('keep-element: excludePreExistingRelationshipIds leaves that one Q retracted', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'e', 'E'), createEl('d1', 'x', 'X'), createRel('d2', 'q', 'uses', 'e', 'x')],
      [updateAttr('d-ours-update', 'e', 'vendor', 'Acme', 'd0')],
      [retractRel('d-theirs-retract-q', 'q', 'uses', 'd2'), retractEl('d-theirs-retract-e', 'e', 'd0')],
    );
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action: 'keep-element', excludePreExistingRelationshipIds: ['q'] }];
    const result = buildStructuralResolutions(review, choices, 'src', idMinter('m'));

    expect(result.mergeDeltas.map((d) => d.kind)).toEqual(['element.restore']); // no rrestore(q)
    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.relationships.has('q')).toBe(false);
  });

  it('keep-retraction: our own dangling relationship is retracted in P, no restore, main\'s retract stands', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'e', 'E'), createEl('d1', 'y', 'Y')],
      [createRel('d-ours-rel', 's', 'uses', 'y', 'e')],
      [retractEl('d-theirs-retract-e', 'e', 'd0')],
    );
    const choices: StructuralChoice[] = [{ class: 'retraction', elementId: 'e', action: 'keep-retraction' }];
    const result = buildStructuralResolutions(review, choices, 'src', idMinter('m'));

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'relationship.retract', relationshipId: 's' })]);
    expect(result.mergeDeltas).toEqual([]);

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.elements.has('e')).toBe(false);
    expect(finalHead.relationships.has('s')).toBe(false);
  });
});

describe('structural: converged-retract', () => {
  it('is resolved automatically with no choice at all — a plain restore in P, nothing in M', () => {
    const { review, ours, theirsExtra } = scenario([createEl('d0', 'e', 'X')], [retractEl('d-ours-retract', 'e', 'd0')], [retractEl('d-theirs-retract', 'e', 'd0')]);
    const result = buildStructuralResolutions(review, [], 'src', idMinter('m'));

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'element.restore', elementId: 'e', previousDeltaId: 'd-ours-retract' })]);
    expect(result.mergeDeltas).toEqual([]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-ours-retract', discardedDeltaId: 'd-theirs-retract', resolutionDeltaId: expect.any(String), rationale: 'converged' }]);

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.elements.has('e')).toBe(false); // main's replayed retract reapplies after the restore
  });
});

describe('structural: duplicate-relationship survivor pick', () => {
  it('the loser is retracted in M; the survivor stands', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'a', 'A'), createEl('d1', 'b', 'B')],
      [createRel('d-ours-rel', 'rel-ours', 'uses', 'a', 'b')],
      [createRel('d-theirs-rel', 'rel-theirs', 'uses', 'a', 'b')],
    );
    const choice: DuplicateRelationshipChoice = { class: 'duplicate-relationship', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep: 'ours' };
    const result = buildStructuralResolutions(review, [choice], 'src', idMinter('m'));

    expect(result.prepDeltas).toEqual([]);
    expect(result.mergeDeltas).toEqual([expect.objectContaining({ kind: 'relationship.retract', relationshipId: 'rel-theirs', previousDeltaId: 'd-theirs-rel' })]);
    expect(result.resolvedConflicts).toEqual([{ winningDeltaId: 'd-ours-rel', discardedDeltaId: 'd-theirs-rel', resolutionDeltaId: expect.any(String), rationale: 'survivor' }]);

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.relationships.has('rel-ours')).toBe(true);
    expect(finalHead.relationships.has('rel-theirs')).toBe(false);
  });
});

describe('structural: cardinality — supports.role primary pick', () => {
  it('keep ours: P demotes ours, M demotes theirs then re-promotes ours', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'sys', 'System'), createCapability('d1', 'capA', 'A'), createCapability('d2', 'capB', 'B')],
      [createRel('d-ours-rel', 'rel-ours', 'supports', 'sys', 'capA', { role: 'primary' })],
      [createRel('d-theirs-rel', 'rel-theirs', 'supports', 'sys', 'capB', { role: 'primary' })],
    );
    const choice: CardinalityChoice = { class: 'cardinality', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep: 'ours' };
    const result = buildStructuralResolutions(review, [choice], 'src', idMinter('m'));

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel-ours', value: 'secondary', previousDeltaId: 'd-ours-rel' })]);
    expect(result.mergeDeltas).toEqual([
      expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel-theirs', value: 'secondary', previousDeltaId: 'd-theirs-rel' }),
      expect.objectContaining({ kind: 'relationship.update', relationshipId: 'rel-ours', value: 'primary', previousDeltaId: result.prepDeltas[0]?.id }),
    ]);

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.relationships.get('rel-ours')?.attributes.role).toBe('primary');
    expect(finalHead.relationships.get('rel-theirs')?.attributes.role).toBe('secondary');
  });

  it('keep theirs: P demotes ours, M has no own deltas — theirs stands', () => {
    const { review, ours, theirsExtra } = scenario(
      [createEl('d0', 'sys', 'System'), createCapability('d1', 'capA', 'A'), createCapability('d2', 'capB', 'B')],
      [createRel('d-ours-rel', 'rel-ours', 'supports', 'sys', 'capA', { role: 'primary' })],
      [createRel('d-theirs-rel', 'rel-theirs', 'supports', 'sys', 'capB', { role: 'primary' })],
    );
    const choice: CardinalityChoice = { class: 'cardinality', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep: 'theirs' };
    const result = buildStructuralResolutions(review, [choice], 'src', idMinter('m'));

    expect(result.mergeDeltas).toEqual([]);
    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.relationships.get('rel-ours')?.attributes.role).toBe('secondary');
    expect(finalHead.relationships.get('rel-theirs')?.attributes.role).toBe('primary');
  });
});

describe('structural: cardinality — owns.role pick (no neutral value: retract/restore, not update)', () => {
  it('keep ours: P retracts ours, M retracts theirs and restores ours', () => {
    const { review, ours, theirsExtra } = scenario(
      [createActor('d0', 'owner1', 'Team A'), createActor('d1', 'owner2', 'Team B'), createEl('d2', 'target', 'Target')],
      [createRel('d-ours-rel', 'rel-ours', 'owns', 'owner1', 'target', { role: 'business' })],
      [createRel('d-theirs-rel', 'rel-theirs', 'owns', 'owner2', 'target', { role: 'business' })],
    );
    const choice: CardinalityChoice = { class: 'cardinality', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep: 'ours' };
    const result = buildStructuralResolutions(review, [choice], 'src', idMinter('m'));

    expect(result.prepDeltas).toEqual([expect.objectContaining({ kind: 'relationship.retract', relationshipId: 'rel-ours' })]);
    expect(result.mergeDeltas.map((d) => d.kind)).toEqual(['relationship.retract', 'relationship.restore']);
    expect(result.mergeDeltas[0]).toEqual(expect.objectContaining({ relationshipId: 'rel-theirs' }));
    expect(result.mergeDeltas[1]).toEqual(expect.objectContaining({ relationshipId: 'rel-ours', previousDeltaId: result.prepDeltas[0]?.id }));

    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.relationships.has('rel-ours')).toBe(true);
    expect(finalHead.relationships.has('rel-theirs')).toBe(false);
  });

  it('keep theirs: P retracts ours, M has no own deltas', () => {
    const { review, ours, theirsExtra } = scenario(
      [createActor('d0', 'owner1', 'Team A'), createActor('d1', 'owner2', 'Team B'), createEl('d2', 'target', 'Target')],
      [createRel('d-ours-rel', 'rel-ours', 'owns', 'owner1', 'target', { role: 'business' })],
      [createRel('d-theirs-rel', 'rel-theirs', 'owns', 'owner2', 'target', { role: 'business' })],
    );
    const choice: CardinalityChoice = { class: 'cardinality', relationshipId: 'rel-ours', relatedRelationshipId: 'rel-theirs', keep: 'theirs' };
    const result = buildStructuralResolutions(review, [choice], 'src', idMinter('m'));

    expect(result.mergeDeltas).toEqual([]);
    const finalHead = replay(ours, result.prepDeltas, theirsExtra, result.mergeDeltas);
    expect(finalHead.relationships.has('rel-ours')).toBe(false);
    expect(finalHead.relationships.has('rel-theirs')).toBe(true);
  });
});

describe('unresolvedStructuralFindings (C15, amended)', () => {
  it('lists every blocking finding with no matching choice, ignores converged-retract entirely', () => {
    const { review } = scenario(
      [createEl('d0', 'e', 'X'), createEl('d1', 'converged', 'C')],
      [retractEl('d-ours-retract', 'e', 'd0'), retractEl('d-ours-retract2', 'converged', 'd1')],
      [updateAttr('d-theirs-update', 'e', 'vendor', 'Acme', 'd0'), retractEl('d-theirs-retract2', 'converged', 'd1')],
    );
    expect(unresolvedStructuralFindings(review.classification.findings, [])).toEqual([expect.objectContaining({ class: 'structural:retract-vs-modify', subjectId: 'e' })]);
  });

  it('is empty once a matching choice exists', () => {
    const { review } = scenario([createEl('d0', 'e', 'X')], [retractEl('d-ours-retract', 'e', 'd0')], [updateAttr('d-theirs-update', 'e', 'vendor', 'Acme', 'd0')]);
    const choice: RetractionChoice = { class: 'retraction', elementId: 'e', action: 'keep-element' };
    expect(unresolvedStructuralFindings(review.classification.findings, [choice])).toEqual([]);
  });
});
