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
import type { OwnDeltaOrigin } from './branch';
import { classifyMerge } from './merge';
import { buildStructuralResolutions, type RetractionChoice } from './mergeResolution';
import { diffFacts } from './branch';
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

        const origins: OwnDeltaOrigin[] = branchDeltas.map((delta) => ({ delta, commitKind: 'manual' }));
        let seq = 0;
        const built = buildSplitDeltas(origins, closure, baseHead, () => `fresh-${String((seq += 1))}`);

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

/**
 * P-32 (ADR-021 §7, C2b): "for any accepted subset, buildSplitDeltas folds
 * over the merge base and passes C8/C9 — the existing property, with
 * resolved refreshes in the generators." Extends the scenario above: some
 * of the branch's retracted base elements went through a *real* resolved
 * refresh (`buildStructuralResolutions`, a genuine `preparation` + `merge`
 * commit pair, per ADR-021 §4.1) before the split is attempted — exactly
 * the shape §1.3.3 names as the split-ordering bug ("the branch's own
 * delta list contains the conflicting delta first and its resolution
 * later"). The merge base used for the split is *main's own current head*
 * (post-refresh), not the original fork point — the split is always
 * computed against `mergeBase(B) == main.head`, which a completed refresh
 * guarantees (SPEC §7.1) — so this generator has to build that advanced
 * base for real, the same way a live refresh would leave it.
 */
describe('P-32: split after a resolved refresh (structural)', () => {
  /**
   * One retracted base element `E`, "main" independently creates a new
   * relationship referencing it (retract-vs-modify + dangling-endpoint,
   * ADR-021 §4.1 Case A) — the concrete shape issue #76 named. `choice`
   * picks which of the two resolution actions the (hypothetical) refresh
   * took; the split then requests a random subset of {E, main's new
   * relationship's own far endpoint, the branch's own unrelated new
   * capabilities}.
   */
  const resolvedRefreshScenarioArb: fc.Arbitrary<{ newMainHead: Head; origins: OwnDeltaOrigin[]; changesetIds: UUID[] }> = fc
    .constantFrom<RetractionChoice['action']>('keep-retraction', 'keep-element')
    .chain((action) =>
      fc.integer({ min: 0, max: 3 }).map((extraNewCount) => {
        const baseDeltas: Delta[] = [
          { kind: 'element.create', id: 'd0', elementId: 'e', elementType: 'system', name: 'E', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 },
          { kind: 'element.create', id: 'd1', elementId: 'f', elementType: 'system', name: 'F', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'src', confidence: 1 },
        ];
        const baseHead = fold(emptyHead(), baseDeltas, ctx);

        const oursRetract: Delta = { kind: 'element.retract', id: 'd-ours-retract', elementId: 'e', elementType: 'system', previousDeltaId: 'd0', sourceId: 'src', confidence: 1 };
        const oursExtra: Delta[] = [oursRetract];
        const ours = fold(fold(emptyHead(), baseDeltas, ctx), oursExtra, ctx);

        const theirsExtra: Delta[] = [
          { kind: 'relationship.create', id: 'd-theirs-rel', relationshipId: 'r', relationshipType: 'uses', fromElementId: 'f', toElementId: 'e', attributes: {}, sourceId: 'src', confidence: 1 },
        ];
        const theirs = fold(fold(emptyHead(), baseDeltas, ctx), theirsExtra, ctx);

        const fields = diffFacts(baseHead, ours, theirs);
        const classification = classifyMerge({ base: baseHead, ours, theirs, fields });
        const review = { threeWay: { mergeBaseCommitId: 'base', base: baseHead, ours, theirs, fields, upToDateWithMain: false }, classification };

        let seq = 0;
        const mintId = () => `resolution-${String((seq += 1))}`;
        const { prepDeltas, mergeDeltas } = buildStructuralResolutions(review, [{ class: 'retraction', elementId: 'e', action }], 'merge-resolution-source', mintId);

        // The advanced merge base: main's own current head, which already
        // includes its own exclusive commit (creating `r`) — exactly what
        // a completed refresh leaves main looking like. `theirs` already
        // *is* main's head in this scenario; no further main-side commits.
        const newMainHead = theirs;

        // The branch's own full delta history since the (now-advanced)
        // merge base: the original retract, the preparation commit's own
        // deltas, the merge commit's own decision deltas, plus a random
        // handful of unrelated new capabilities (ordinary manual commits)
        // — some accepted, some not, exercising pull-in/block alongside
        // the resolved-refresh shape in the same split.
        const extraOrigins: OwnDeltaOrigin[] = [];
        const extraIds: UUID[] = [];
        for (let i = 0; i < extraNewCount; i += 1) {
          const id = `extra-${String(i)}`;
          extraOrigins.push({ delta: { kind: 'element.create', id: `extra-create-${String(i)}`, elementId: id, elementType: 'capability', name: `Extra ${String(i)}`, parentId: null, attributes: {}, sourceId: 'src', confidence: 1 }, commitKind: 'manual' });
          extraIds.push(id);
        }

        const origins: OwnDeltaOrigin[] = [
          { delta: oursRetract, commitKind: 'manual' },
          ...prepDeltas.map((delta) => ({ delta, commitKind: 'preparation' as const })),
          ...mergeDeltas.map((delta) => ({ delta, commitKind: 'merge' as const })),
          ...extraOrigins,
        ];

        return { newMainHead, origins, changesetIds: ['e', 'r', ...extraIds] };
      }),
    );

  it('folds cleanly over the advanced main head for any requested subset, after a resolved keep-retraction or keep-element refresh', () => {
    fc.assert(
      fc.property(resolvedRefreshScenarioArb, fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), ({ newMainHead, origins, changesetIds }, picks) => {
        const requested = new Set(changesetIds.filter((_, i) => picks[i % picks.length] ?? false));
        const closure = computeSplitClosure(
          origins.map((o) => o.delta),
          newMainHead,
          requested,
        );
        let seq = 0;
        const built = buildSplitDeltas(origins, closure, newMainHead, () => `fresh-${String((seq += 1))}`);
        expect(() => fold(newMainHead, built, ctx)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
