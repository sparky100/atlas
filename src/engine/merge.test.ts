/**
 * Unit tests for src/engine/merge.ts's classifyMerge — one per conflict
 * class in SPEC-data-model.md §7.3's table, plus the clean/baseline case.
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { diffFacts } from './branch';
import { emptyHead, fold, type CommitContext, type Head } from './deltas';
import type { CommitLoader, CommitNode } from './head';
import { classifyMerge, computeMergeReview, type MergeClassifyInput } from './merge';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function createEl(id: UUID, elementId: UUID, name: string, attributes: Record<string, unknown> = { lifecycleStatus: 'active', isExternal: false }, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId, attributes: attributes as never, sourceId: 'src', confidence: 1 };
}

function createContainer(id: UUID, elementId: UUID, name: string, parentId: UUID): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'container', name, parentId, attributes: { isExternal: false }, sourceId: 'src', confidence: 1 };
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

function retract(id: UUID, elementId: UUID, previousDeltaId: UUID): Delta {
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

function updateRel(id: UUID, relationshipId: UUID, relationshipType: 'uses' | 'owns' | 'flows_to' | 'supports', attribute: string, value: unknown, previousDeltaId: UUID): Delta {
  return { kind: 'relationship.update', id, relationshipId, relationshipType, attribute: attribute as never, value: value as never, previousDeltaId, sourceId: 'src', confidence: 1 };
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
  it('both sides creating a same-role owns relationship to the same target is blocking, even with different owners', () => {
    const input = scenario(
      [createActor('d0', 'owner1', 'Team A'), createActor('d1', 'owner2', 'Team B'), createEl('d2', 'target', 'Target System')],
      [createRel('d-ours', 'rel-ours', 'owns', 'owner1', 'target', { role: 'business' })],
      [createRel('d-theirs', 'rel-theirs', 'owns', 'owner2', 'target', { role: 'business' })],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:cardinality', blocking: true, subjectId: 'rel-ours', relatedSubjectId: 'rel-theirs' }));
  });

  it('a business owns and a technical owns to the same target is not a cardinality conflict', () => {
    const input = scenario(
      [createActor('d0', 'owner1', 'Team A'), createActor('d1', 'owner2', 'Team B'), createEl('d2', 'target', 'Target System')],
      [createRel('d-ours', 'rel-ours', 'owns', 'owner1', 'target', { role: 'business' })],
      [createRel('d-theirs', 'rel-theirs', 'owns', 'owner2', 'target', { role: 'technical' })],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'structural:cardinality')).toEqual([]);
  });

  it('both sides creating a primary supports relationship on the same anchor is blocking (ADR-021 §5 item 2)', () => {
    const input = scenario(
      [createEl('d0', 'sys', 'System'), createCapability('d1', 'capA', 'Capability A'), createCapability('d2', 'capB', 'Capability B')],
      [createRel('d-ours', 'rel-ours', 'supports', 'sys', 'capA', { role: 'primary' })],
      [createRel('d-theirs', 'rel-theirs', 'supports', 'sys', 'capB', { role: 'primary' })],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:cardinality', blocking: true, subjectId: 'rel-ours', relatedSubjectId: 'rel-theirs' }));
  });

  it('a primary and a secondary supports on the same anchor is not a cardinality conflict — secondary has no cardinality limit', () => {
    const input = scenario(
      [createEl('d0', 'sys', 'System'), createCapability('d1', 'capA', 'Capability A'), createCapability('d2', 'capB', 'Capability B')],
      [createRel('d-ours', 'rel-ours', 'supports', 'sys', 'capA', { role: 'primary' })],
      [createRel('d-theirs', 'rel-theirs', 'supports', 'sys', 'capB', { role: 'secondary' })],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'structural:cardinality')).toEqual([]);
  });

  it('the create-vs-promote shape: one side creates a new primary, the other promotes an existing secondary to primary on the same anchor', () => {
    const input = scenario(
      [createEl('d0', 'sys', 'System'), createCapability('d1', 'capA', 'Capability A'), createCapability('d2', 'capB', 'Capability B'), createRel('d3', 'rel-existing', 'supports', 'sys', 'capA', { role: 'secondary' })],
      [createRel('d-ours', 'rel-ours', 'supports', 'sys', 'capB', { role: 'primary' })],
      [updateRel('d-theirs', 'rel-existing', 'supports', 'role', 'primary', 'd3')],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:cardinality', blocking: true, subjectId: 'rel-ours', relatedSubjectId: 'rel-existing' }));
  });

  it('the promote-vs-promote shape: both sides promote different existing owns edges to the same role on the same target', () => {
    const input = scenario(
      [
        createActor('d0', 'owner1', 'Team A'),
        createActor('d1', 'owner2', 'Team B'),
        createEl('d2', 'target', 'Target System'),
        createRel('d3', 'rel1', 'owns', 'owner1', 'target', { role: 'technical' }),
        createRel('d4', 'rel2', 'owns', 'owner2', 'target', { role: 'service' }),
      ],
      [updateRel('d-ours', 'rel1', 'owns', 'role', 'business', 'd3')],
      [updateRel('d-theirs', 'rel2', 'owns', 'role', 'business', 'd4')],
    );
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'structural:cardinality', blocking: true, subjectId: 'rel1', relatedSubjectId: 'rel2' }));
  });

  it('a pre-existing primary neither side touches is not re-flagged just because it exists (UNCHANGED, not a collision)', () => {
    const input = scenario(
      [createEl('d0', 'sys', 'System'), createCapability('d1', 'capA', 'Capability A'), createRel('d2', 'rel-existing', 'supports', 'sys', 'capA', { role: 'primary' })],
      [updateAttr('d-ours', 'sys', 'vendor', 'Acme', 'd0')],
      [],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'structural:cardinality')).toEqual([]);
  });
});

describe('structural: converged-retract', () => {
  it('both sides retracting the same element is a non-blocking finding, never a card, but not "clean" either', () => {
    const input = scenario([createEl('d0', 'el', 'X')], [retract('d-ours', 'el', 'd0')], [retract('d-theirs', 'el', 'd0')]);
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(false);
    expect(result.findings).toEqual([expect.objectContaining({ class: 'structural:converged-retract', blocking: false, subjectId: 'el' })]);
    expect(result.clean).not.toContain('el');
  });

  it('a plain refresh with only a converged retract has zero blocking conflicts (the case that used to throw before ADR-021)', () => {
    const input = scenario([createEl('d0', 'a', 'A'), createEl('d1', 'b', 'B')], [retract('d-ours', 'a', 'd0')], [retract('d-theirs', 'a', 'd0')]);
    const result = classifyMerge(input);
    expect(result.hasBlockingConflict).toBe(false);
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

  it('a close typo in the name (E7: trigram similarity, not exact equality) is a match once context corroborates', () => {
    const input = scenario(
      [],
      [createEl('d-ours', 'x1', 'Billing Service', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' })],
      [createEl('d-theirs', 'x2', 'Billing Servcie', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' })],
    );
    const result = classifyMerge(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'identity', blocking: false, subjectId: 'x1', relatedSubjectId: 'x2' }));
  });

  it('a name too far from any match (below the trigram threshold) is never an identity finding, even with matching context', () => {
    const input = scenario(
      [],
      [createEl('d-ours', 'x1', 'Billing Service', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' })],
      [createEl('d-theirs', 'x2', 'Customer Portal', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' })],
    );
    const result = classifyMerge(input);
    expect(result.findings.filter((f) => f.class === 'identity')).toEqual([]);
  });

  it('a fuzzy name match with different parents (or none) still matches when vendor agrees (E7 context: vendor)', () => {
    const input = scenario(
      [],
      [createEl('d-ours', 'x1', 'Billing Service', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme Corp' })],
      [createEl('d-theirs', 'x2', 'Billing Servicee', { lifecycleStatus: 'active', isExternal: false, vendor: 'acme corp' })],
    );
    const result = classifyMerge(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'identity', subjectId: 'x1', relatedSubjectId: 'x2' }));
  });

  it('a fuzzy name match with a different vendor but matching description still matches (E7 context: description)', () => {
    const input = scenario(
      [],
      [createEl('d-ours', 'x1', 'Billing Service', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme', description: 'Handles customer invoicing' })],
      [createEl('d-theirs', 'x2', 'Billing Servicee', { lifecycleStatus: 'active', isExternal: false, vendor: 'Globex', description: 'Handles customer invoicing' })],
    );
    const result = classifyMerge(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'identity', subjectId: 'x1', relatedSubjectId: 'x2' }));
  });

  it('a fuzzy name match with a shared owning actor still matches, with no vendor/description overlap at all (E7 context: owner)', () => {
    const owner = createActor('d-owner', 'team1', 'Platform Team');
    const input = scenario(
      [owner],
      [createEl('d-ours', 'x1', 'Billing Service'), createRel('d-ours-owns', 'r-ours', 'owns', 'team1', 'x1', { role: 'business' })],
      [createEl('d-theirs', 'x2', 'Billing Servicee'), createRel('d-theirs-owns', 'r-theirs', 'owns', 'team1', 'x2', { role: 'business' })],
    );
    const result = classifyMerge(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ class: 'identity', subjectId: 'x1', relatedSubjectId: 'x2' }));
  });

  it('a fuzzy name match with no parent, vendor, description or owner overlap at all is not a match', () => {
    const ownerOurs = createActor('d-owner-ours', 'teamA', 'Team A');
    const ownerTheirs = createActor('d-owner-theirs', 'teamB', 'Team B');
    const input = scenario(
      [ownerOurs, ownerTheirs],
      [createEl('d-ours', 'x1', 'Billing Service', { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' }), createRel('d-ours-owns', 'r-ours', 'owns', 'teamA', 'x1', { role: 'business' })],
      [createEl('d-theirs', 'x2', 'Billing Servicee', { lifecycleStatus: 'active', isExternal: false, vendor: 'Globex' }), createRel('d-theirs-owns', 'r-theirs', 'owns', 'teamB', 'x2', { role: 'business' })],
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

function commitNode(partial: Pick<CommitNode, 'id' | 'parent_commit_id' | 'depth' | 'deltas'> & Partial<CommitNode>): CommitNode {
  return {
    org_id: 'org',
    model_id: 'model',
    branch_id: 'unspecified',
    merged_branch_head_commit_id: null,
    kind: 'manual',
    title: '',
    body: null,
    author_id: 'author-1',
    head_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('computeMergeReview', () => {
  /**
   * genesis(main) --main1(main)
   *        \-- branch1(branch)
   * genesis creates 'el'. main1 updates name -> 'Renamed by main'. branch1
   * updates name -> 'Renamed by branch' — a real branch head vs. main head,
   * not the Head-level fixtures `scenario()` builds above, since
   * `computeMergeReview` takes commit ids and a `CommitLoader` and calls
   * `threeWayDiff` itself (SPEC §7.1's mergeBase) before classifying.
   */
  function buildFixture() {
    const nodes = new Map<UUID, CommitNode>();
    const genesis = commitNode({ id: 'genesis', parent_commit_id: null, depth: 0, kind: 'template_seed', branch_id: 'main', deltas: [createEl('d0', 'el', 'X')] });
    const main1 = commitNode({ id: 'main1', parent_commit_id: 'genesis', depth: 1, branch_id: 'main', deltas: [updateAttr('d-main', 'el', 'name', 'Renamed by main', 'd0')] });
    const branch1 = commitNode({ id: 'branch1', parent_commit_id: 'genesis', depth: 1, branch_id: 'branch', deltas: [updateAttr('d-branch', 'el', 'name', 'Renamed by branch', 'd0')] });
    for (const c of [genesis, main1, branch1]) nodes.set(c.id, c);
    const loader: CommitLoader = (id) => nodes.get(id);
    return { loader, genesis, main1, branch1 };
  }

  it('runs threeWayDiff then classifyMerge together, surfacing a field-conflict end to end from commit ids', () => {
    const { loader, main1, branch1 } = buildFixture();
    const review = computeMergeReview(branch1.id, main1.id, loader);
    expect(review.threeWay.mergeBaseCommitId).toBe('genesis');
    expect(review.classification.hasBlockingConflict).toBe(true);
    expect(review.classification.findings).toEqual([expect.objectContaining({ class: 'field-conflict', subjectId: 'el', attribute: 'name' })]);
  });

  it('is clean, with no findings, when the branch has not diverged from main on any shared field', () => {
    const { loader, genesis, branch1 } = buildFixture();
    const review = computeMergeReview(branch1.id, genesis.id, loader);
    expect(review.classification.hasBlockingConflict).toBe(false);
    expect(review.classification.findings).toEqual([]);
    expect(review.classification.clean).toContain('el');
  });
});
