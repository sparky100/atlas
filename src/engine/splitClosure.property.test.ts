/**
 * Property test for src/engine/splitClosure.ts (Sprint C2, Prompt 7b step
 * 1's own acceptance test): "for any accepted subset, folding `accepted ∪
 * pulledIn` over the merge base yields a head that passes C8 and C9 with
 * no dangling references." Checked by actually folding the result with
 * the same `apply`/`fold` every commit path uses (`apply`'s own C8 check —
 * "still has a live relationship referencing it" — throws an
 * `EngineError` the moment a fold would violate it, src/engine/deltas.ts's
 * own module comment) — a `fold` that completes without throwing *is* the
 * property holding, not a separate hand-rolled check that could drift
 * from what `apply` actually enforces.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Delta, UUID } from '../contracts/delta';
import { emptyHead, fold, type CommitContext, type Head } from './deltas';
import { buildSplitDeltas, computeSplitClosure } from './splitClosure';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };

/**
 * A small, random branch scenario: a handful of pre-existing capabilities
 * on the merge base, then a branch that creates some new capabilities
 * (each parented on either a pre-existing one or an earlier new one — a
 * DAG by construction, since a capability can only name an
 * already-generated id as its parent) and retracts a random subset of the
 * pre-existing ones (each retract immediately followed by retracting
 * every pre-existing `supports`-style edge — modelled here as a second
 * capability's `parentId` pointing at it, the one structural reference
 * two capabilities can have — that still points at it, so the *branch
 * itself* stays foldable; `computeSplitClosure`'s own job is what happens
 * when a reviewer accepts only some of that).
 */
interface Scenario {
  baseHead: Head;
  branchDeltas: Delta[];
  changesetIds: UUID[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .integer({ min: 1, max: 4 })
  .chain((baseCount) => {
    const baseIds = Array.from({ length: baseCount }, (_, i) => `base-${String(i)}`);
    const baseDeltas: Delta[] = baseIds.map((id, i) => ({
      kind: 'element.create',
      id: `base-create-${String(i)}`,
      elementId: id,
      elementType: 'capability',
      name: `Base ${String(i)}`,
      parentId: null,
      attributes: {},
      sourceId: 'src',
      confidence: 1,
    }));
    const baseHead = fold(emptyHead(), baseDeltas, ctx);

    return fc
      .array(
        fc.record({
          newId: fc.uuid(),
          // Parent chosen from base ids or "root" — new-on-new parenting
          // is handled by picking from `newIds so far` at build time below.
          parentIsBase: fc.boolean(),
          parentBaseIndex: fc.integer({ min: 0, max: Math.max(0, baseCount - 1) }),
        }),
        { minLength: 0, maxLength: 4 },
      )
      .chain((newSpecs) =>
        fc.subarray(baseIds).chain((retractedBaseIds) =>
          fc.record({ newSpecs: fc.constant(newSpecs), retractedBaseIds: fc.constant(retractedBaseIds), requestedFraction: fc.array(fc.boolean(), { minLength: 0, maxLength: 20 }) }),
        ),
      )
      .map(({ newSpecs, retractedBaseIds }) => {
        const branchDeltas: Delta[] = [];
        const newIds: UUID[] = [];
        const seenNewIds = new Set<UUID>();
        let seq = 0;
        for (const spec of newSpecs) {
          if (seenNewIds.has(spec.newId)) continue; // fast-check's own uuid() can repeat across a short array; skip a duplicate rather than modelling a same-id double-create.
          seenNewIds.add(spec.newId);
          const parentId = spec.parentIsBase || newIds.length === 0 ? (baseIds[spec.parentBaseIndex] ?? null) : (newIds[spec.parentBaseIndex % newIds.length] ?? null);
          branchDeltas.push({ kind: 'element.create', id: `new-create-${String(seq)}`, elementId: spec.newId, elementType: 'capability', name: `New ${String(seq)}`, parentId, attributes: {}, sourceId: 'src', confidence: 1 });
          newIds.push(spec.newId);
          seq += 1;
        }
        // A retracted base capability must itself have no live child
        // referencing it (parentId) left in the branch's own head — the
        // scenario only retracts *leaf* base capabilities (nothing new
        // parented on them) so the branch's own history stays foldable
        // (this generator's job is varied *closures*, not exercising
        // apply()'s own C8 check a second time).
        const parentedOn = new Set(branchDeltas.filter((d) => d.kind === 'element.create').map((d) => (d as { parentId: UUID | null }).parentId).filter((id): id is UUID => id !== null));
        for (const id of retractedBaseIds) {
          if (parentedOn.has(id)) continue;
          const createIdx = baseIds.indexOf(id);
          branchDeltas.push({ kind: 'element.retract', id: `retract-${id}`, elementId: id, elementType: 'capability', previousDeltaId: `base-create-${String(createIdx)}`, sourceId: 'src', confidence: 1 });
        }
        const changesetIds = [...newIds, ...retractedBaseIds.filter((id) => !parentedOn.has(id))];
        return { baseHead, branchDeltas, changesetIds };
      });
  });

describe('computeSplitClosure property: the result always folds cleanly over the merge base', () => {
  it('for any requested subset of the branch changeset, folding accepted ∪ pulledIn never throws (C8 holds)', () => {
    fc.assert(
      fc.property(scenarioArb, fc.array(fc.boolean(), { minLength: 0, maxLength: 8 }), ({ baseHead, branchDeltas, changesetIds }, picks) => {
        const requested = new Set(changesetIds.filter((_, i) => picks[i % picks.length || 0] ?? false));
        const closure = computeSplitClosure(branchDeltas, baseHead, requested);

        let seq = 0;
        const built = buildSplitDeltas(branchDeltas, closure, () => `fresh-${String((seq += 1))}`);

        // The property itself: this must not throw. `fold` starts from
        // `baseHead` (the merge base) exactly as the real split commit
        // would be parented on it.
        expect(() => fold(baseHead, built, ctx)).not.toThrow();

        // A blocked retract is never silently included.
        for (const b of closure.blocked) expect(closure.accepted.has(b.subjectId)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
