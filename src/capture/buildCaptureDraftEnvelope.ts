/**
 * F2 (full K1), SPEC-capture.md §8.1 step 3 / §4.4: turns a run's own
 * already-resolved `CaptureCandidate`s into the one `CommitEnvelope`
 * `atlas.write_capture_draft` commits atomically to a brand-new
 * `capture_draft` branch. Pure — no id minting beyond the injected
 * `mintId` (delta ids only; every candidate's own `draftSubjectId` — the
 * element/relationship id its deltas write to — is minted upstream by the
 * orchestrator, PR10, before this module ever sees it, exactly like
 * `useElementCreate.ts` mints its own element id before building its own
 * `element.create`).
 *
 * §4.4's own class → delta table, mechanically:
 *  - `new`: one `element.create`/`relationship.create`, every attribute in
 *    `proposal.attributes` at once (§4.2: "a create's initial attributes
 *    all point at the create delta").
 *  - `update` / `confirm` / `conflict` / `ambiguous`: one `element.update`/
 *    `relationship.update` per key already present in `proposal.attributes`
 *    — this module trusts that set exactly as given. *Which* attributes
 *    belong there (every proposed one, for `confirm`'s K-6 provenance
 *    refresh; only the differing ones for `update`/`conflict`) is
 *    `classify.ts`'s call, made upstream — re-deciding it here would
 *    duplicate PR2's own job and cut across the `src/capture` layering.
 *    `ambiguous` resolves against `match`'s own best hit (`draftSubjectId`
 *    is already that), same shape as a plain `update` from here down.
 *  - `gone` (re-import only, PR9): system → one `element.update`
 *    `lifecycleStatus = 'retired'`; any other element type →
 *    `element.retract`. `GONE_CONFIDENCE` always (K-14) — the retirement
 *    is an inference from absence, not a document-stated fact with its
 *    own per-attribute confidence, so `proposal` is never consulted here.
 *  - `invalid` / `unsourced`: no deltas (§4.4 — these never reach this
 *    module with anything to write).
 *
 * `previousDeltaId` for a matched subject's own attribute: main's current
 * fact for that exact (subjectId, attribute) — falling back to the
 * subject's own `existsDeltaId` when there isn't one yet (a document
 * stating an attribute for the first time on an already-existing element).
 * This is the same fallback rule (`facts.get(attribute)?.delta_id ??
 * existsDeltaId`) every other capture-write path in this codebase uses:
 * `element.update.previousDeltaId` can never be null (`deltas`'s own
 * `(kind in (create kinds)) = (previous_delta_id is null)` check), and
 * SPEC §4.2's "facts[(subject,attr)].delta_id is always defined for any
 * *live* attribute" is about an attribute that has ever been asserted, not
 * one a create happened to omit — `classifyAttribute` (PR2) explicitly
 * treats "no main fact yet" as a legitimate `update`, and this is how that
 * case becomes a legal delta rather than an impossible one.
 *
 * A matched candidate's own `proposal.name` is never turned into a rename
 * here — it's this run's own *identification* of the element (what
 * matched it), not a rename proposal; §4.4 describes no such behaviour
 * and this module doesn't invent one.
 *
 * Cross-candidate collisions (two different candidates in one run
 * resolving to the same (subjectId, attribute), which would fail C4) are
 * the orchestrator's own job to rule out before calling this — each
 * candidate here is built independently of every other.
 */
import type { CandidateRef, CaptureCandidate } from '../contracts/capture';
import type { CommitEnvelope, Delta, Json, UUID } from '../contracts/delta';
import { formatSourceRef } from '../contracts/sourceRef';
import type { Head } from '../engine/deltas';
import { factMapKey } from '../engine/deltas';
import { GONE_CONFIDENCE, matchConfidenceFor, updateConf } from './confidence';

export class CaptureDraftEnvelopeError extends Error {}

export interface BuildCaptureDraftEnvelopeInput {
  commitId: UUID;
  branchId: UUID;
  /** The `capture_draft` branch's own base commit — main's head at the moment the branch was created (§8.1 step 1). */
  parentCommitId: UUID;
  title: string;
  body: string | null;
  /** This run's own `sources` row (`kind: 'capture_job'`) — every delta in the commit shares it. */
  sourceId: UUID;
  /** `capture_jobs.document_date` — every delta's own `effectiveDate`. */
  effectiveDate: string | null;
  /** Main's current head, at the commit `parentCommitId` points to — where every `previousDeltaId` and every matched subject's `existsDeltaId` comes from. */
  mainHead: Head;
  /**
   * Already resolved: every non-`invalid`/`unsourced` candidate carries a
   * real `draftSubjectId`, and every `CandidateRef` inside its `proposal`
   * is `{kind:'existing', elementId}` (or, for a `new` element's `parent`,
   * `null`) — never `'candidate'`/`'unresolved'`. That resolution is the
   * orchestrator's own job (PR10), not this module's.
   */
  candidates: readonly CaptureCandidate[];
  /** Delta ids only — every subject id this module writes to (`draftSubjectId`) is already minted by the caller. */
  mintId: () => UUID;
}

export interface BuildCaptureDraftEnvelopeResult {
  envelope: CommitEnvelope;
  /** This run's own draft delta ids, per candidate `seq` (§8.1 step 5's `capture_candidates.draft_delta_ids`) — present (possibly empty) for every candidate, `invalid`/`unsourced` included. */
  draftDeltaIdsBySeq: ReadonlyMap<number, UUID[]>;
}

function resolvedElementId(ref: CandidateRef | null, seq: number, field: string): UUID | null {
  if (ref === null) return null;
  if (ref.kind !== 'existing') {
    throw new CaptureDraftEnvelopeError(`seq ${String(seq)}: ${field} is not resolved (${ref.kind}) — buildCaptureDraftEnvelope requires every candidate ref already resolved to a real element id`);
  }
  return ref.elementId;
}

function sourceRefFor(candidate: CaptureCandidate, attribute?: string): string {
  const ref = (attribute !== undefined ? candidate.evidence.attributeRefs?.[attribute] : undefined) ?? candidate.evidence.sourceRef;
  return formatSourceRef(ref);
}

function requireExistsDeltaId(head: Head, kind: 'element' | 'relationship', subjectId: UUID, seq: number): UUID {
  const existsDeltaId = kind === 'element' ? head.elements.get(subjectId)?.existsDeltaId : head.relationships.get(subjectId)?.existsDeltaId;
  if (existsDeltaId === undefined) {
    throw new CaptureDraftEnvelopeError(`seq ${String(seq)}: matched ${kind} ${subjectId} was not found in main's current head`);
  }
  return existsDeltaId;
}

function requireDraftSubjectId(candidate: CaptureCandidate, situation: string): UUID {
  if (candidate.draftSubjectId === null) {
    throw new CaptureDraftEnvelopeError(`seq ${String(candidate.seq)}: ${situation} needs a resolved draftSubjectId`);
  }
  return candidate.draftSubjectId;
}

/**
 * Dependency rank for delta ordering: top-level element creates, then childed
 * element creates, then relationship creates/updates — a create must precede
 * anything that references it, but candidates arrive in document order (a
 * relationship can precede the element it names). Shared with
 * `captureRunStep.ts`'s own fault-tolerant fold, which must walk the same
 * order.
 */
export function candidateDeltaRank(candidate: CaptureCandidate): number {
  if (candidate.kind !== 'element') return 2;
  return candidate.proposal.kind === 'element' && candidate.proposal.parent !== null ? 1 : 0;
}

/** One `element.update`/`relationship.update` per key in `attributes`, `previousDeltaId`/confidence resolved uniformly for either subject kind. */
function buildAttributeUpdateDeltas(
  candidate: CaptureCandidate,
  subjectId: UUID,
  existsDeltaId: UUID,
  attributes: Readonly<Record<string, Json>>,
  mainHead: Head,
  buildOne: (attribute: string, value: Json, previousDeltaId: UUID, confidence: number, sourceRef: string) => Delta,
): Delta[] {
  const matchConfidence = matchConfidenceFor(candidate.match);
  return Object.keys(attributes)
    .sort()
    .map((attribute) => {
      const value = attributes[attribute] as Json;
      const fact = mainHead.facts.get(factMapKey(subjectId, attribute));
      const previousDeltaId = fact?.deltaId ?? existsDeltaId;
      const attrConfidence = candidate.evidence.attributeConfidence[attribute] ?? candidate.confidence;
      const confidence = updateConf(attrConfidence, matchConfidence);
      return buildOne(attribute, value, previousDeltaId, confidence, sourceRefFor(candidate, attribute));
    });
}

export function buildCaptureDraftEnvelope(input: BuildCaptureDraftEnvelopeInput): BuildCaptureDraftEnvelopeResult {
  const { commitId, branchId, parentCommitId, title, body, sourceId, effectiveDate, mainHead, candidates, mintId } = input;
  const provenance = (confidence: number) => ({ sourceId, confidence, ...(effectiveDate !== null ? { effectiveDate } : {}) });
  const deltas: Delta[] = [];
  const draftDeltaIdsBySeq = new Map<number, UUID[]>();

  // Deltas are folded in list order, and a create must precede anything that
  // references it — but candidates arrive in document order, where a
  // relationship (or a childed element) can precede the element it names
  // (the element is identified later in the text). Re-order for delta
  // building only: top-level elements, then childed elements, then
  // relationships, stable by `seq` within each rank. `draftDeltaIdsBySeq`
  // below stays keyed by each candidate's own original `seq` regardless.
  const deltaOrder = [...candidates].sort((a, b) => candidateDeltaRank(a) - candidateDeltaRank(b) || a.seq - b.seq);

  for (const candidate of deltaOrder) {
    const before = deltas.length;

    // duplicate_in_target (issue #285, K-8): matches something already proposed on the target change
    // branch, not yet on main — the draft forks from main, so there is no legal delta to write here at all.
    if (candidate.class === 'invalid' || candidate.class === 'unsourced' || candidate.class === 'duplicate_in_target') {
      draftDeltaIdsBySeq.set(candidate.seq, []);
      continue;
    }

    if (candidate.class === 'gone') {
      if (candidate.kind !== 'element' || candidate.elementType === null) {
        throw new CaptureDraftEnvelopeError(`seq ${String(candidate.seq)}: a relationship candidate can never be class 'gone' (SPEC-capture.md §4.4)`);
      }
      const subjectId = requireDraftSubjectId(candidate, "a 'gone' candidate");
      const elementType = candidate.elementType;
      const existsDeltaId = requireExistsDeltaId(mainHead, 'element', subjectId, candidate.seq);
      // system-only: SPEC-capture K-14: a gone system is retired by lifecycle; every other type, a module included, is retracted. Whether a gone module should be retired too is open.
      if (elementType === 'system') {
        const previousDeltaId = mainHead.facts.get(factMapKey(subjectId, 'lifecycleStatus'))?.deltaId ?? existsDeltaId;
        deltas.push({
          kind: 'element.update',
          id: mintId(),
          elementId: subjectId,
          elementType,
          attribute: 'lifecycleStatus',
          value: 'retired',
          previousDeltaId,
          sourceRef: sourceRefFor(candidate),
          ...provenance(GONE_CONFIDENCE),
        } as never);
      } else {
        deltas.push({
          kind: 'element.retract',
          id: mintId(),
          elementId: subjectId,
          elementType,
          previousDeltaId: existsDeltaId,
          sourceRef: sourceRefFor(candidate),
          ...provenance(GONE_CONFIDENCE),
        } as never);
      }
      draftDeltaIdsBySeq.set(
        candidate.seq,
        deltas.slice(before).map((d) => d.id),
      );
      continue;
    }

    const proposal = candidate.proposal;

    if (proposal.kind === 'element') {
      const elementType = proposal.elementType;
      if (candidate.class === 'new') {
        const elementId = requireDraftSubjectId(candidate, "a 'new' candidate");
        const parentId = resolvedElementId(proposal.parent, candidate.seq, 'parent');
        deltas.push({
          kind: 'element.create',
          id: mintId(),
          elementId,
          elementType,
          name: proposal.name,
          parentId,
          attributes: proposal.attributes,
          sourceRef: sourceRefFor(candidate),
          ...provenance(candidate.confidence),
        } as never);
      } else {
        const subjectId = requireDraftSubjectId(candidate, 'a matched candidate');
        const existsDeltaId = requireExistsDeltaId(mainHead, 'element', subjectId, candidate.seq);
        deltas.push(
          ...buildAttributeUpdateDeltas(candidate, subjectId, existsDeltaId, proposal.attributes, mainHead, (attribute, value, previousDeltaId, confidence, sourceRef) =>
            ({
              kind: 'element.update',
              id: mintId(),
              elementId: subjectId,
              elementType,
              attribute,
              value,
              previousDeltaId,
              sourceRef,
              ...provenance(confidence),
            }) as never,
          ),
        );
      }
    } else {
      const relationshipType = proposal.relationshipType;
      if (candidate.class === 'new') {
        const relationshipId = requireDraftSubjectId(candidate, "a 'new' candidate");
        const fromElementId = resolvedElementId(proposal.from, candidate.seq, 'from');
        const toElementId = resolvedElementId(proposal.to, candidate.seq, 'to');
        if (fromElementId === null || toElementId === null) {
          throw new CaptureDraftEnvelopeError(`seq ${String(candidate.seq)}: a relationship needs resolved from/to endpoints`);
        }
        deltas.push({
          kind: 'relationship.create',
          id: mintId(),
          relationshipId,
          relationshipType,
          fromElementId,
          toElementId,
          attributes: proposal.attributes,
          sourceRef: sourceRefFor(candidate),
          ...provenance(candidate.confidence),
        } as never);
      } else {
        const subjectId = requireDraftSubjectId(candidate, 'a matched candidate');
        const existsDeltaId = requireExistsDeltaId(mainHead, 'relationship', subjectId, candidate.seq);
        deltas.push(
          ...buildAttributeUpdateDeltas(candidate, subjectId, existsDeltaId, proposal.attributes as Record<string, Json>, mainHead, (attribute, value, previousDeltaId, confidence, sourceRef) =>
            ({
              kind: 'relationship.update',
              id: mintId(),
              relationshipId: subjectId,
              relationshipType,
              attribute,
              value,
              previousDeltaId,
              sourceRef,
              ...provenance(confidence),
            }) as never,
          ),
        );
      }
    }

    draftDeltaIdsBySeq.set(
      candidate.seq,
      deltas.slice(before).map((d) => d.id),
    );
  }

  const envelope: CommitEnvelope = {
    id: commitId,
    branchId,
    parentCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'capture',
    title,
    body,
    deltas,
  };

  return { envelope, draftDeltaIdsBySeq };
}
