/**
 * Unit tests for src/engine/splitClosure.ts (Sprint C2, Prompt 7b step 1).
 */
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import type { OwnDeltaOrigin } from './branch';
import { cloneHead, emptyHead, fold, type CommitContext, type Head } from './deltas';
import { buildSplitDeltas, computeSplitClosure } from './splitClosure';

function asOrigins(deltas: readonly Delta[]): OwnDeltaOrigin[] {
  return deltas.map((delta) => ({ delta, commitKind: 'manual' }));
}

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

function createSystem(id: UUID, elementId: UUID, name: string, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 };
}
function createCapability(id: UUID, elementId: UUID, name: string, parentId: UUID | null = null): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'capability', name, parentId, attributes: {}, sourceId: 'src', confidence: 1 };
}
function retractEl(id: UUID, elementId: UUID, elementType: 'system' | 'capability', previousDeltaId: UUID): Delta {
  return { kind: 'element.retract', id, elementId, elementType, previousDeltaId, sourceId: 'src', confidence: 1 };
}
function createUses(id: UUID, relationshipId: UUID, fromElementId: UUID, toElementId: UUID): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'uses', fromElementId, toElementId, attributes: { description: 'reads from' }, sourceId: 'src', confidence: 1 };
}
function createSupports(id: UUID, relationshipId: UUID, fromElementId: UUID, toElementId: UUID): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId: 'src', confidence: 1 };
}
function retractRel(id: UUID, relationshipId: UUID, relationshipType: 'uses' | 'supports', previousDeltaId: UUID): Delta {
  return { kind: 'relationship.retract', id, relationshipId, relationshipType, previousDeltaId, sourceId: 'src', confidence: 1 };
}

describe('computeSplitClosure', () => {
  it('accepts a subject that requests exactly what exists on the branch, with nothing pulled in or blocked', () => {
    const branchDeltas: Delta[] = [createSystem('d1', 'sys-a', 'A')];
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['sys-a']));
    expect(closure.accepted).toEqual(new Set(['sys-a']));
    expect(closure.pulledIn).toEqual(new Set());
    expect(closure.blocked).toEqual([]);
  });

  it('a request for a subject the branch never touched is simply dropped — not accepted, not an error', () => {
    const branchDeltas: Delta[] = [createSystem('d1', 'sys-a', 'A')];
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['sys-a', 'not-on-this-branch']));
    expect(closure.accepted).toEqual(new Set(['sys-a']));
  });

  it('pull-in: accepting a new relationship pulls in its own new endpoint', () => {
    const branchDeltas: Delta[] = [createSystem('d1', 'sys-a', 'A'), createSystem('d2', 'sys-b', 'B'), createUses('d3', 'rel-1', 'sys-a', 'sys-b')];
    // Only the relationship requested — sys-a and sys-b are both new on
    // this branch, so both must come along for it to be valid at all.
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['rel-1']));
    expect(closure.accepted).toEqual(new Set(['rel-1', 'sys-a', 'sys-b']));
    expect(closure.pulledIn).toEqual(new Set(['sys-a', 'sys-b']));
    expect(closure.blocked).toEqual([]);
  });

  it('pull-in: one new endpoint already existed at the merge base — only the new one is pulled in', () => {
    const baseHead = fold(emptyHead(), [createSystem('base-1', 'sys-a', 'A')], ctx);
    const branchDeltas: Delta[] = [createSystem('d2', 'sys-b', 'B'), createUses('d3', 'rel-1', 'sys-a', 'sys-b')];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['rel-1']));
    expect(closure.accepted).toEqual(new Set(['rel-1', 'sys-b']));
    expect(closure.pulledIn).toEqual(new Set(['sys-b']));
  });

  it('pull-in: an accepted new child element pulls in its own new parent', () => {
    const branchDeltas: Delta[] = [createCapability('d1', 'cap-1', 'Finance'), createCapability('d2', 'cap-2', 'Payments', 'cap-1')];
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['cap-2']));
    expect(closure.accepted).toEqual(new Set(['cap-2', 'cap-1']));
    expect(closure.pulledIn).toEqual(new Set(['cap-1']));
  });

  it('pull-in is transitive: a grandchild pulls in its parent, which pulls in its own parent', () => {
    const branchDeltas: Delta[] = [createCapability('d1', 'cap-1', 'Finance'), createCapability('d2', 'cap-2', 'Payments', 'cap-1'), createCapability('d3', 'cap-3', 'Cards', 'cap-2')];
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['cap-3']));
    expect(closure.accepted).toEqual(new Set(['cap-3', 'cap-2', 'cap-1']));
    expect(closure.pulledIn).toEqual(new Set(['cap-2', 'cap-1']));
  });

  it('block: retracting a pre-existing element still referenced by an untouched relationship in main is blocked, named', () => {
    const baseHead = fold(
      emptyHead(),
      [createSystem('base-1', 'sys-a', 'A'), createSystem('base-2', 'sys-b', 'B'), createUses('base-3', 'rel-1', 'sys-a', 'sys-b')],
      ctx,
    );
    const branchDeltas: Delta[] = [retractEl('d1', 'sys-b', 'system', 'base-2')];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['sys-b']));
    expect(closure.accepted).toEqual(new Set());
    expect(closure.blocked).toEqual([{ subjectId: 'sys-b', dependentSubjectId: 'rel-1', dependentSubjectType: 'relationship', dependentIsPreExisting: true }]);
  });

  it('not blocked: retracting a pre-existing element whose only referencing relationship is also retracted (and accepted) in the same split', () => {
    const baseHead = fold(
      emptyHead(),
      [createSystem('base-1', 'sys-a', 'A'), createSystem('base-2', 'sys-b', 'B'), createUses('base-3', 'rel-1', 'sys-a', 'sys-b')],
      ctx,
    );
    const branchDeltas: Delta[] = [retractRel('d1', 'rel-1', 'uses', 'base-3'), retractEl('d2', 'sys-b', 'system', 'base-2')];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['sys-b', 'rel-1']));
    expect(closure.accepted).toEqual(new Set(['sys-b', 'rel-1']));
    expect(closure.blocked).toEqual([]);
  });

  it('block: a new (branch-created) live relationship referencing a retracted element blocks the retract when only the retract is requested', () => {
    // sys-a already exists; the branch creates sys-b and a `supports` from
    // sys-b to sys-a, and separately retracts sys-a. Splitting off only
    // the retract would leave a dangling `supports` once sys-b's own
    // create is also accepted.
    const baseHead = fold(emptyHead(), [createSystem('base-1', 'sys-a', 'A')], ctx);
    const branchDeltas: Delta[] = [createCapability('d1', 'cap-b', 'B'), createSupports('d2', 'rel-1', 'sys-a', 'cap-b'), retractEl('d3', 'sys-a', 'system', 'base-1')];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['sys-a', 'cap-b', 'rel-1']));
    expect(closure.blocked).toEqual([{ subjectId: 'sys-a', dependentSubjectId: 'rel-1', dependentSubjectType: 'relationship', dependentIsPreExisting: false }]);
    // The rest of the requested set still goes through — only the
    // dependent retract itself is refused, not everything requested
    // alongside it.
    expect(closure.accepted).toEqual(new Set(['cap-b', 'rel-1']));
  });

  it('not blocked: the same new relationship is fine when its own retract is also requested', () => {
    const baseHead = fold(emptyHead(), [createSystem('base-1', 'sys-a', 'A')], ctx);
    const branchDeltas: Delta[] = [
      createCapability('d1', 'cap-b', 'B'),
      createSupports('d2', 'rel-1', 'sys-a', 'cap-b'),
      retractRel('d3', 'rel-1', 'supports', 'd2'),
      retractEl('d4', 'sys-a', 'system', 'base-1'),
    ];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['sys-a', 'cap-b', 'rel-1']));
    expect(closure.blocked).toEqual([]);
    expect(closure.accepted).toEqual(new Set(['sys-a', 'cap-b', 'rel-1']));
  });
});

describe('buildSplitDeltas', () => {
  it('mints a fresh id for every accepted delta and drops anything not accepted', () => {
    const branchDeltas: Delta[] = [createSystem('d1', 'sys-a', 'A'), createSystem('d2', 'sys-b', 'B')];
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['sys-a']));
    let i = 0;
    const fresh: UUID[] = ['fresh-1', 'fresh-2'];
    const built = buildSplitDeltas(asOrigins(branchDeltas), closure, emptyHead(), () => {
      const id = fresh[i];
      i += 1;
      if (!id) throw new Error('ran out of fresh ids');
      return id;
    });
    expect(built).toEqual([expect.objectContaining({ kind: 'element.create', id: 'fresh-1', elementId: 'sys-a' })]);
  });

  it('re-points previousDeltaId to the fresh id minted earlier in the same replay, for a chain wholly inside the split', () => {
    const branchDeltas: Delta[] = [
      createSystem('d1', 'sys-a', 'A'),
      { kind: 'element.update', id: 'd2', elementId: 'sys-a', elementType: 'system', attribute: 'name', value: 'Renamed', previousDeltaId: 'd1', sourceId: 'src', confidence: 1 },
    ];
    const closure = computeSplitClosure(branchDeltas, emptyHead(), new Set(['sys-a']));
    let i = 0;
    const fresh: UUID[] = ['fresh-create', 'fresh-update'];
    const built = buildSplitDeltas(asOrigins(branchDeltas), closure, emptyHead(), () => {
      const id = fresh[i];
      i += 1;
      if (!id) throw new Error('ran out of fresh ids');
      return id;
    });
    expect(built[1]).toMatchObject({ id: 'fresh-update', previousDeltaId: 'fresh-create' });
  });

  it('re-anchors previousDeltaId to the merge base\'s own currently-asserting delta when it points outside the split', () => {
    // sys-a already exists at the merge base (created there as 'base-create') — the branch only updates it.
    const baseHead = fold(emptyHead(), [createSystem('base-create', 'sys-a', 'A')], ctx);
    const branchDeltas: Delta[] = [{ kind: 'element.update', id: 'd1', elementId: 'sys-a', elementType: 'system', attribute: 'name', value: 'Renamed', previousDeltaId: 'base-create', sourceId: 'src', confidence: 1 }];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['sys-a']));
    const built = buildSplitDeltas(asOrigins(branchDeltas), closure, baseHead, () => 'fresh-1');
    // 'base-create' is exactly what the merge base currently asserts for sys-a's name — re-anchoring lands on the same id the original branch delta already had, for this untouched-by-anyone-else case.
    expect(built[0]).toMatchObject({ id: 'fresh-1', previousDeltaId: 'base-create' });
  });

  it('folds cleanly over the merge base — the whole point of the closure', () => {
    const baseHead: Head = emptyHead();
    const branchDeltas: Delta[] = [createSystem('d1', 'sys-a', 'A'), createSystem('d2', 'sys-b', 'B'), createUses('d3', 'rel-1', 'sys-a', 'sys-b')];
    const closure = computeSplitClosure(branchDeltas, baseHead, new Set(['rel-1']));
    let i = 0;
    const built = buildSplitDeltas(asOrigins(branchDeltas), closure, baseHead, () => `fresh-${String((i += 1))}`);
    const folded = fold(emptyHead(), built, ctx);
    expect(folded.elements.size).toBe(2);
    expect(folded.relationships.size).toBe(1);
  });

  describe('after a resolved refresh (ADR-021 §5 item 4, §1.3.3)', () => {
    // Base: E, F. Our own branch retracts E. Main independently creates a
    // `uses` relationship F -> E — the exact shape issue #76 named. The
    // refresh resolves it; the branch's own delta history (what
    // listOwnDeltaOrigins would return) now literally contains
    // [retract(e), restore(e)_prep, ...decision deltas]. The split's own
    // merge base is main's *current* head (post-refresh) — which already
    // has E live and the relationship F->E live, since main's own commits
    // are now part of it.
    const eAndF: Delta[] = [createSystem('d0', 'e', 'E'), createSystem('d1', 'f', 'F')];
    const mainCreatesRel: Delta = createUses('d-main-rel', 'r', 'f', 'e');
    const newMainHead = fold(emptyHead(), [...eAndF, mainCreatesRel], ctx);

    it('keep-retraction: the original retract and the preparation restore both collapse away; only the final retract (re-anchored) and the relationship retract survive', () => {
      const origins: OwnDeltaOrigin[] = [
        { delta: retractEl('d-ours-retract', 'e', 'system', 'd0'), commitKind: 'manual' },
        { delta: { kind: 'element.restore', id: 'd-p-restore', elementId: 'e', elementType: 'system', previousDeltaId: 'd-ours-retract', sourceId: 'src', confidence: 1 }, commitKind: 'preparation' },
        { delta: retractRel('d-m-rretract', 'r', 'uses', 'd-main-rel'), commitKind: 'merge' },
        { delta: retractEl('d-m-final-retract', 'e', 'system', 'd-p-restore'), commitKind: 'merge' },
      ];
      const closure = computeSplitClosure(
        origins.map((o) => o.delta),
        newMainHead,
        new Set(['e', 'r']),
      );
      let i = 0;
      const built = buildSplitDeltas(origins, closure, newMainHead, () => `fresh-${String((i += 1))}`);

      expect(built.map((d) => d.kind)).toEqual(['relationship.retract', 'element.retract']);
      expect(built[1]).toMatchObject({ elementId: 'e', previousDeltaId: 'd0' }); // re-anchored to the new base's own exists-delta, not the (now-collapsed) preparation restore

      const folded = fold(cloneHead(newMainHead), built, ctx);
      expect(folded.elements.has('e')).toBe(false);
      expect(folded.relationships.has('r')).toBe(false);
    });

    it('keep-element: the whole existence chain collapses to nothing — main already holds exactly what the branch ends up wanting', () => {
      const origins: OwnDeltaOrigin[] = [
        { delta: retractEl('d-ours-retract', 'e', 'system', 'd0'), commitKind: 'manual' },
        { delta: { kind: 'element.restore', id: 'd-p-restore', elementId: 'e', elementType: 'system', previousDeltaId: 'd-ours-retract', sourceId: 'src', confidence: 1 }, commitKind: 'preparation' },
        // keep-element: no merge-own deltas at all for e.
      ];
      const closure = computeSplitClosure(
        origins.map((o) => o.delta),
        newMainHead,
        new Set(['e']),
      );
      const built = buildSplitDeltas(origins, closure, newMainHead, () => 'fresh-1');

      expect(built).toEqual([]);
      expect(() => fold(newMainHead, built, ctx)).not.toThrow();
    });
  });
});
