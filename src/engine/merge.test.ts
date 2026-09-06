/**
 * Unit tests for src/engine/merge.ts's classifyMerge — one per conflict
 * class in SPEC-data-model.md §7.3's table, plus the clean/baseline case.
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { diffFacts } from './branch';
import { emptyHead, fold, type CommitContext, type Head } from './deltas';
import { classifyMerge, type MergeClassifyInput } from './merge';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function createEl(id: UUID, elementId: UUID, name: string, attributes: Record<string, unknown> = { lifecycleStatus: 'active', isExternal: false }, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}

function createContainer(id: UUID, elementId: UUID, name: string, parentId: UUID): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'container', name, parentId, attributes: { isExternal: false }, sourceId: 'src', confidence: 1 };
}

function createActor(id: UUID, elementId: UUID, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'actor', name, parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: 'src', confidence: 1 };
}

function updateAttr(id: UUID, elementId: UUID, attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'element.update', id, elementId, elementType: 'system', attribute: attribute as never, value: value as never, previousDeltaId, sourceId: 'src', confidence: 1 };
}

function retract(id: UUID, elementId: UUID, previousDeltaId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType: 'system', previousDeltaId, sourceId: 'src', confidence: 1 };
}

function createRel(id: UUID, relationshipId: UUID, relationshipType: 'uses' | 'owns' | 'flows_to', fromElementId: UUID, toElementId: UUID, attributes: Record<string, unknown> = {}): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType, fromElementId, toElementId, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}

/** Folds baseDeltas alone for `base`, baseDeltas+oursExtra for `ours`, baseDeltas+theirsExtra for `theirs`, and computes the field diff — the shape classifyMerge takes. */
function scenario(baseDeltas: Delta[], oursExtra: Delta[], theirsExtra: Delta[]): MergeClassifyInput {
  const base: Head = fold(emptyHead(), baseDeltas, ctx);
  const ours: Head = fold(fold(emptyHead(), baseDeltas, ctx), oursExtra, ctx);
  const theirs: Head = fold(fold(emptyHead(), baseDeltas, ctx), theirsExtra, ctx);
  return { base, ours, theirs, fields: diffFacts(base, ours, theirs) };
}

describe('field-conflict', () => {
  it('both sides changing the same field to different values is a blocking field-conflict, one finding per field', () => {
    const input = scenario(
      [createEl('d0', 'el', 'X')],
      [updateAttr('d-ours', 'el', 'name', 'Renamed by ours', 'd0')],
      [updateAttr('d-theirs', 'el', 'name', 'Renamed by theirs', 'd0')],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toEqual([expect.objectContaining({ class: 'field-conflict', blocking: true, subjectId: 'el', attribute: 'name' })]);
    expect(result.clean).not.toContain('el');
  });

  it('reasserting the same value from both sides is CONVERGED, not a field-conflict (no finding at all)', () => {
    const input = scenario(
      [createEl('d0', 'el', 'X')],
      [updateAttr('d-ours', 'el', 'name', 'Same', 'd0')],
      [updateAttr('d-theirs', 'el', 'name', 'Same', 'd0')],
    );
    const result = classifyMerge(input);
    expect(result.findings).toEqual([]);
    expect(result.clean).toContain('el');
  });
});

describe('structural: retract-vs-modify', () => {
  it('retracted on one side, genuinely modified on the other, is blocking', () => {
    const input = scenario([createEl('d0', 'el', 'X')], [retract('d-ours', 'el', 'd0')], [updateAttr('d-theirs', 'el', 'lifecycleStatus', 'retiring', 'd0')]);
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:retract-vs-modify', blocking: true, subjectId: 'el' }));
  });

  it('retracted on one side, left untouched on the other, is not a retract-vs-modify (nothing to conflict with)', () => {
    const input = scenario([createEl('d0', 'el', 'X')], [retract('d-ours', 'el', 'd0')], []);
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'structural:retract-vs-modify')).toEqual([]);
  });
});

describe('structural: dangling-endpoint', () => {
  it('a relationship created on one side referencing an element retracted on the other is blocking', () => {
    const input = scenario(
      [createEl('d0', 'el1', 'A'), createEl('d1', 'el2', 'B')],
      [retract('d-ours', 'el1', 'd0')],
      [createRel('d-theirs', 'rel1', 'uses', 'el2', 'el1')],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:dangling-endpoint', blocking: true, subjectId: 'el1', relatedSubjectId: 'rel1' }));
  });
});

describe('structural: dangling-parent', () => {
  it('an element reparented (or created) under an element retracted on the other side is blocking', () => {
    const input = scenario(
      [createEl('d0', 'sys', 'System')],
      [retract('d-ours', 'sys', 'd0')],
      [createContainer('d-theirs', 'container1', 'New Container', 'sys')],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:dangling-parent', blocking: true, subjectId: 'container1', relatedSubjectId: 'sys' }));
  });
});

describe('structural: duplicate-relationship', () => {
  it('both sides independently creating the same (type, from, to) relationship is blocking', () => {
    const input = scenario(
      [createEl('d0', 'a', 'A'), createEl('d1', 'b', 'B')],
      [createRel('d-ours', 'rel-ours', 'uses', 'a', 'b')],
      [createRel('d-theirs', 'rel-theirs', 'uses', 'a', 'b')],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ class: 'structural:duplicate-relationship', blocking: true, subjectId: 'rel-ours', relatedSubjectId: 'rel-theirs' }),
    );
  });

  it('relationships of different types between the same pair are not a duplicate', () => {
    // Both `uses` and `flows_to` allow (system, system) as a triple (Sprint
    // H1's RELATIONSHIP_TYPE_RULES) — `owns` doesn't (it needs an actor
    // source), so this test uses `flows_to` as its second type rather than
    // `owns` as it did before that rule was enforced.
    const input = scenario(
      [createEl('d0', 'a', 'A'), createEl('d1', 'b', 'B')],
      [createRel('d-ours', 'rel-ours', 'uses', 'a', 'b')],
      [createRel('d-theirs', 'rel-theirs', 'flows_to', 'a', 'b')],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'structural:duplicate-relationship')).toEqual([]);
  });
});

describe('structural: cardinality', () => {
  it('both sides creating a primary owns relationship to the same target is blocking, even with different owners', () => {
    const input = scenario(
      [createActor('d0', 'owner1', 'Team A'), createActor('d1', 'owner2', 'Team B'), createEl('d2', 'target', 'Target System')],
      [createRel('d-ours', 'rel-ours', 'owns', 'owner1', 'target', { primary: true })],
      [createRel('d-theirs', 'rel-theirs', 'owns', 'owner2', 'target', { primary: true })],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:cardinality', blocking: true, subjectId: 'rel-ours', relatedSubjectId: 'rel-theirs' }));
  });

  it('a primary owns and a non-primary owns to the same target is not a cardinality conflict', () => {
    const input = scenario(
      [createActor('d0', 'owner1', 'Team A'), createActor('d1', 'owner2', 'Team B'), createEl('d2', 'target', 'Target System')],
      [createRel('d-ours', 'rel-ours', 'owns', 'owner1', 'target', { primary: true })],
      [createRel('d-theirs', 'rel-theirs', 'owns', 'owner2', 'target', { primary: false })],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'structural:cardinality')).toEqual([]);
  });
});

describe('identity (weak: name + type + context)', () => {
  it('both sides creating an element of the same type, normalised name, and parent is a non-blocking identity finding', () => {
    const input = scenario([], [createEl('d-ours', 'x1', 'Widget Service')], [createEl('d-theirs', 'x2', '  widget service  ')]);
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'identity', blocking: false, subjectId: 'x1', relatedSubjectId: 'x2' }));
    // Identity is advisory: it must not appear in "clean" (it needs a decision) but must never block approval.
    expect(result.clean).not.toContain('x1');
  });

  it('same name but different parents is not an identity match', () => {
    const input = scenario(
      [createEl('d0', 'sysA', 'System A'), createEl('d1', 'sysB', 'System B')],
      [createContainer('d-ours', 'c1', 'Gateway', 'sysA')],
      [createContainer('d-theirs', 'c2', 'Gateway', 'sysB')],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'identity')).toEqual([]);
  });
});

describe('identity (strong: matching alias)', () => {
  it('both sides creating elements that share a known alias is a non-blocking identity:strong finding, independent of name', () => {
    const input = scenario([], [createEl('d-ours', 'y1', 'Widget Svc')], [createEl('d-theirs', 'y2', 'WidgetService Ltd')]);
    const aliasesByElementId = new Map<UUID, readonly string[]>([
      ['y1', ['WGT-01']],
      ['y2', ['WGT-01']],
    ]);
    const result = classifyMerge(input, { aliasesByElementId });
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'identity:strong', blocking: false, subjectId: 'y1', relatedSubjectId: 'y2' }));
    // The names don't match, so the weak check alone would have found nothing.
    expect(classifyMerge(input).findings).toEqual([]);
  });

  it('is skipped entirely (not silently "no match") when no alias data is supplied', () => {
    const input = scenario([], [createEl('d-ours', 'y1', 'Widget Svc')], [createEl('d-theirs', 'y2', 'WidgetService Ltd')]);
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'identity:strong')).toEqual([]);
  });
});

describe('clean', () => {
  it('changes to different fields of the same element on each side are clean, not conflicts', () => {
    const input = scenario([createEl('d0', 'el', 'X')], [updateAttr('d-ours', 'el', 'vendor', 'Acme', 'd0')], [updateAttr('d-theirs', 'el', 'lifecycleStatus', 'retiring', 'd0')]);
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.clean).toContain('el');
  });

  it('an element untouched by either side is trivially clean (all-UNCHANGED satisfies the spec\'s "all keys UNCHANGED/OURS/THEIRS/CONVERGED" clean rule) and never appears in a finding', () => {
    const input = scenario([createEl('d0', 'untouched', 'Untouched'), createEl('d1', 'el', 'X')], [updateAttr('d-ours', 'el', 'vendor', 'Acme', 'd1')], []);
    const result = classifyMerge(input);
    expect(result.clean).toContain('untouched');
    expect(result.findings.some((f) => f.subjectId === 'untouched')).toBe(false);
  });
});
