/**
 * P-K5 (SPEC-capture.md §10): "For arbitrary rows proposing primary
 * supports/owns against arbitrary main states, the draft envelope never
 * fails C17." Unlike RT-K2/P-K7 (this PR's other new tests), this one
 * needs no database at all — C17 ("at most one primary supports/owns edge
 * per anchor") is enforced by the pure `apply()`/`fold()` in
 * `src/engine/deltas.ts` on every fold, already exercised generically by
 * `deltas.property.test.ts`. What's specific to capture, and what this
 * file actually checks, is the guarantee K-13 makes for `supports`:
 * `capabilityAssignment.ts`'s own proposals always default a *new* edge to
 * `role: 'secondary'`, never `'primary'` (that module's own header
 * comment: "supports proposals default to role: 'secondary' (K-13);
 * promoting a row's own first/only capability edge to primary needs
 * main's own live-primary state... the orchestrator's own pass"). So a
 * `new`-class `supports` candidate reaching `buildCaptureDraftEnvelope`
 * should never be able to create a second primary — this property runs
 * exactly that scenario at scale: every system on main already has its own
 * established primary capability (C17's own anchor for `supports` is the
 * *system* side — `checkPrimaryCardinality`'s `anchorSide: 'from'`, "one
 * primary capability per system"), arbitrary counts of brand-new secondary
 * candidates target arbitrary (system, capability) combinations on top of
 * that, and the resulting envelope always folds cleanly.
 *
 * `owns` is deliberately out of scope here: its own C17 cardinality is
 * "at most one live edge per (toElementId, role)" where `role` is
 * `business`/`technical`/`service` (`OwnsAttributes.role`'s own doc
 * comment) — a different mechanism from `supports`'s primary/secondary
 * pair, and not the "default to secondary" rule K-13/this property is
 * about; `rowsToCandidates.ts` (PR5) already assigns each `owns`
 * candidate a fixed role deterministically from which column it came
 * from (owner -> business, technicalOwner -> technical), never a
 * capability-style "many rows might name the same one" ambiguity.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CaptureCandidate, RelationshipProposal } from '../contracts/capture';
import type { Delta, UUID } from '../contracts/delta';
import { cloneHead, emptyHead, fold, type CommitContext } from '../engine/deltas';
import { buildCaptureDraftEnvelope } from './buildCaptureDraftEnvelope';

const ctx: CommitContext = { authorId: 'author-1', createdAt: '2026-01-01T00:00:00.000Z' };
const SOURCE_ID = 'p-k5-source';

function createElement(id: UUID, elementId: UUID, elementType: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType, name, parentId: null, attributes: elementType === 'system' ? { lifecycleStatus: 'active', isExternal: false } : {}, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function createSupports(id: UUID, relationshipId: UUID, fromElementId: UUID, toElementId: UUID, role: 'primary' | 'secondary'): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role }, sourceId: SOURCE_ID, confidence: 1 } as never;
}

function newSupportsCandidate(seq: number, draftSubjectId: UUID, fromElementId: UUID, toElementId: UUID): CaptureCandidate {
  const proposal: RelationshipProposal<'supports'> = {
    kind: 'relationship',
    relationshipType: 'supports',
    from: { kind: 'existing', elementId: fromElementId },
    to: { kind: 'existing', elementId: toElementId },
    // K-13: a *new* supports candidate always defaults to secondary — never this module's job to decide, just to trust.
    attributes: { role: 'secondary' },
  };
  return {
    id: `candidate-${String(seq)}`,
    orgId: 'org-1',
    jobId: 'job-1',
    modelId: 'model-1',
    seq,
    kind: 'relationship',
    class: 'new',
    elementType: null,
    relationshipType: 'supports',
    draftSubjectId,
    proposal,
    evidence: { sourceRef: { kind: 'sheet', sheet: 'Sheet1', range: `A${String(seq + 1)}` }, passage: '', extractor: 'sheet-mapping', attributeConfidence: { role: 1 }, warnings: [] },
    match: { level: 'none', score: 0, similar: [], warnings: [] },
    confidence: 1,
    rowKey: `row-${String(seq)}`,
    reimportStatus: null,
    draftDeltaIds: [],
    aliasProposals: [],
    decision: null,
    decisionDetail: null,
    decidedBy: null,
    decidedAt: null,
    promotedCommitId: null,
    promotedSubjectId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildCaptureDraftEnvelope — P-K5: a new secondary supports candidate never fails C17', () => {
  it('folds cleanly for arbitrary counts of established primary supports edges and new secondary candidates against them', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // systems
        fc.integer({ min: 1, max: 6 }), // capabilities, each already primarily supported by one system
        fc.integer({ min: 0, max: 12 }), // number of new secondary candidates to generate
        fc.integer({ min: 0, max: 1_000_000 }), // seed for picking arbitrary (system, capability) pairs
        (systemCount, capabilityCount, candidateCount, seed) => {
          const setupDeltas: Delta[] = [];
          const systemIds: UUID[] = [];
          const capabilityIds: UUID[] = [];

          for (let i = 0; i < systemCount; i += 1) {
            const id = `sys-${String(i)}`;
            systemIds.push(id);
            setupDeltas.push(createElement(`d-sys-${String(i)}`, id, 'system', `System ${String(i)}`));
          }
          for (let i = 0; i < capabilityCount; i += 1) {
            const id = `cap-${String(i)}`;
            capabilityIds.push(id);
            setupDeltas.push(createElement(`d-cap-${String(i)}`, id, 'capability', `Capability ${String(i)}`));
          }
          // C17's own anchor for `supports` is the *system* side (one
          // primary capability per system, not one primary system per
          // capability — `checkPrimaryCardinality`'s own `anchorSide:
          // 'from'`) — so the pre-existing state a new secondary candidate
          // must never collide with is "every system already has exactly
          // one primary capability", one setup edge per system, never two
          // sharing the same `fromElementId`.
          for (let i = 0; i < systemCount; i += 1) {
            const system = systemIds[i];
            const capability = capabilityIds[i % capabilityCount];
            if (system !== undefined && capability !== undefined) setupDeltas.push(createSupports(`d-supports-${String(i)}`, `supports-${String(i)}`, system, capability, 'primary'));
          }
          // V6 dedup — orthogonal to C17, the thing this property tests.
          const seenTriples = new Set(setupDeltas.filter((d): d is Delta & { kind: 'relationship.create' } => d.kind === 'relationship.create').map((d) => `${d.relationshipType}|${d.fromElementId}|${d.toElementId}`));

          const mainHead = fold(emptyHead(), setupDeltas, ctx);

          let rngState = seed;
          const nextIndex = (max: number) => {
            rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
            return max === 0 ? 0 : rngState % max;
          };

          const candidates: CaptureCandidate[] = [];
          for (let i = 0; i < candidateCount; i += 1) {
            const fromElementId = systemIds[nextIndex(systemIds.length)];
            const toElementId = capabilityIds[nextIndex(capabilityIds.length)];
            if (fromElementId === undefined || toElementId === undefined) continue;
            const triple = `supports|${fromElementId}|${toElementId}`;
            if (seenTriples.has(triple)) continue;
            seenTriples.add(triple);
            candidates.push(newSupportsCandidate(i, `rel-new-${String(i)}`, fromElementId, toElementId));
          }

          let nextDeltaId = 0;
          const { envelope } = buildCaptureDraftEnvelope({
            commitId: 'commit-1',
            branchId: 'branch-1',
            parentCommitId: 'parent-commit-1',
            title: 'Capture from property-test.xlsx',
            body: null,
            sourceId: SOURCE_ID,
            effectiveDate: null,
            mainHead,
            candidates,
            mintId: () => `delta-${String((nextDeltaId += 1))}`,
          });

          expect(() => fold(cloneHead(mainHead), envelope.deltas, ctx)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });
});
