/**
 * F2 (full K1) PR8, SPEC-capture.md §8.2 step 1 / "what each decision
 * promotes": the client-side half of promoting a reviewed capture draft
 * onto a real change branch. Pure — no I/O; the caller loads
 * `draftHead`/`targetHead` (`loadCaptureDraftHead.ts`/`loadTargetBranchHead.ts`)
 * and folds the result with `src/engine` before calling
 * `atlas.apply_capture_decisions`, the same "pre-check before the RPC"
 * division of labour `buildCaptureDraftEnvelope.ts` (PR7) already
 * established for the draft write itself.
 *
 * K-4 (re-minting): a `new`-class candidate being `accepted`/`split`/
 * `edited` gets a *fresh* id here (`mintId()`) — its draft id is dead
 * after promotion (SPEC C5/P-11: an id can never appear in two
 * `element.create`s). A `merged` candidate isn't re-minted at all: its
 * "promoted subject" is the existing element the reviewer chose
 * (`decisionDetail.intoElementId`). Either way, every OTHER candidate in
 * this same apply call whose own proposal referenced that draft id (a
 * relationship endpoint, a container's parent) is re-pointed to the real
 * promoted id — the two-pass structure below (assign every element
 * candidate's promoted id first, then build every delta) exists
 * specifically so that re-pointing never depends on candidate order — "a
 * relationship can reference a system created earlier in this very same
 * file" holds regardless of promotion order.
 *
 * Provenance: promoting a machine-proposed value (`accepted`/`merged`/
 * `split`) carries over the *original* capture provenance verbatim —
 * `sourceId`/`sourceRef`/`effectiveDate`/`confidence` come from the
 * matching fact on `draftHead` (the same (subjectId, attribute) key the
 * draft's own `write_capture_draft` commit already asserted), never
 * recomputed from `evidence`. `edited` is the one decision with new,
 * human provenance: `sourceId` = the reviewer's own manual source,
 * `confidence = 1.0` (ADR-007/UI §4.3: 1.0 is reserved for a human
 * assertion), and a `resolved_conflicts` row pairing the new delta
 * (winning) against the draft's own delta for that same fact (discarded).
 *
 * `previousDeltaId` for a matched subject is always re-derived against
 * **`targetHead`**, never the draft's own facts (SPEC §8.1's own note:
 * "Promotion... re-derives previousDeltaId against that [target] branch's
 * current head at apply time, so a stale draft never blocks a review") —
 * falling back to the subject's own `existsDeltaId` for a first-time
 * attribute assertion, the same fallback rule
 * `buildCaptureDraftEnvelope.ts` uses.
 *
 * Aliases (§7.6), scoped to what a persisted `CaptureCandidate` can
 * actually express: a `name` alias for a level-3 (`name_context`) match
 * that's actually promoted, and a `name` alias for a `merged` candidate's
 * own name against the chosen existing element. §7.6 also names
 * `source_system_key` aliases and intra-document-group `name` aliases —
 * both need data (`matchHints.sourceKeys`, a document's own variant
 * spellings) that lives only on `RowCandidate` (PR5's pre-orchestration
 * shape), never persisted onto `CaptureCandidate` itself (PR1's contract).
 * Threading that through is the orchestrator's own job (PR10) once it
 * exists; until then this is a disclosed, narrower-than-spec surface, not
 * a silently-dropped one.
 *
 * `edited` on an `invalid`/`unsourced` candidate needs re-grounding
 * (§10: "the candidate is re-grounded before it can be applied") — that's
 * `src/capture/ground.ts`, PR11, not built yet. This module refuses that
 * one combination with a clear error rather than promoting an ungrounded
 * fact; every other class × decision combination in SPEC's own table is
 * fully built.
 */
import type { CandidateDecisionDetail, CandidateRef, CaptureCandidate } from '../contracts/capture';
import { EXISTS_ATTRIBUTE, type Delta, type Json, type UUID } from '../contracts/delta';
import { factMapKey, type FactRow, type Head } from '../engine/deltas';
import { GONE_CONFIDENCE, matchConfidenceFor } from './confidence';
import { isSystemLikeType } from '../contracts/elementKinds';

/**
 * `seq` (every throw site already computes it — this just stops discarding
 * it into an unstructured message string) and `unresolvedRefId`, set only
 * where the error names one specific missing/unresolved id, are what let a
 * caller turn this into something a reviewer can actually act on
 * (`explainPromotionError.ts`) instead of the raw `message` alone — found
 * the hard way: a reviewer hit "seq 12: to (d4667dbd-…) was not found on
 * the target branch" with no way to connect that id back to anything in
 * the review UI, which never shows a candidate's own `seq` or raw id at
 * all. The underlying cause here specifically was a relationship
 * candidate's own endpoint pointing at an element candidate the reviewer
 * had rejected in the very same review.
 */
export class BuildPromotionEnvelopeError extends Error {
  readonly seq: number;
  readonly unresolvedRefId: UUID | undefined;

  constructor(seq: number, message: string, unresolvedRefId?: UUID) {
    super(message);
    this.name = 'BuildPromotionEnvelopeError';
    this.seq = seq;
    this.unresolvedRefId = unresolvedRefId;
  }
}

export interface AliasRowToInsert {
  id: UUID;
  elementId: UUID;
  aliasValue: string;
  aliasType: 'name';
  sourceId: UUID;
  confidence: number;
}

export interface ResolvedConflictToInsert {
  id: UUID;
  winningDeltaId: UUID;
  discardedDeltaId: UUID;
  rationale: string | null;
}

export interface BuildPromotionEnvelopeInput {
  /** Every candidate being acted on in this apply call — `rejected` ones included (skipped internally, never an error to pass one in). */
  candidates: readonly CaptureCandidate[];
  /** The capture_draft branch's own folded head — original provenance and (for `edited`) the delta being discarded. */
  draftHead: Head;
  /** The target change branch's own current folded head — `previousDeltaId`/`existsDeltaId` source of truth. */
  targetHead: Head;
  /** `sources` row for the reviewer's own manual edits (`getOrCreateManualSource`) — used only for `edited` decisions. */
  reviewerSourceId: UUID;
  /** Delta ids *and* re-minted element/relationship ids (K-4) — one mint function for both, since both are plain UUIDs and the caller mints them the same way either way. */
  mintId: () => UUID;
}

export interface BuildPromotionEnvelopeResult {
  deltas: Delta[];
  /** Every candidate that actually promoted something (not `rejected`), keyed by `seq` — the real subject id its deltas ended up targeting: a fresh id for `accepted`/`split`/`edited` on `new`, the chosen existing element for `merged`/`ambiguous`, or the same id the draft already used for anything already matched. `capture_candidates.promoted_subject_id`'s own value. */
  promotedSubjectIdBySeq: ReadonlyMap<number, UUID>;
  aliasRows: AliasRowToInsert[];
  resolvedConflicts: ResolvedConflictToInsert[];
}

function draftFact(draftHead: Head, draftSubjectId: UUID, attribute: string): FactRow | undefined {
  return draftHead.facts.get(factMapKey(draftSubjectId, attribute));
}

/** Provenance fields (`sourceId`/`sourceRef`/`effectiveDate`/`confidence`) copied verbatim from a draft fact — the "same provenance" every non-`edited` decision carries forward. */
function provenanceFromDraftFact(fact: FactRow | undefined, seq: number, subjectLabel: string): Pick<FactRow, 'sourceId' | 'sourceRef' | 'effectiveDate' | 'confidence'> {
  if (!fact) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: no draft fact found for ${subjectLabel} — the draft head this promotion was built from doesn't match the candidate`);
  return { sourceId: fact.sourceId, ...(fact.sourceRef !== undefined ? { sourceRef: fact.sourceRef } : {}), ...(fact.effectiveDate !== undefined ? { effectiveDate: fact.effectiveDate } : {}), confidence: fact.confidence };
}

function editedProvenance(reviewerSourceId: UUID): { sourceId: UUID; confidence: number } {
  return { sourceId: reviewerSourceId, confidence: 1 };
}

function requireExistsDeltaId(head: Head, kind: 'element' | 'relationship', subjectId: UUID, seq: number, situation: string): UUID {
  const existsDeltaId = kind === 'element' ? head.elements.get(subjectId)?.existsDeltaId : head.relationships.get(subjectId)?.existsDeltaId;
  if (existsDeltaId === undefined) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: ${situation} — ${subjectId} was not found on the given head`);
  return existsDeltaId;
}

/** The `requireExistsDeltaId` message that's actually accurate on the *target* head — TARGET_RETRACTED (§11) is only ever a target-head concern, never a draft-head one (the draft is immutable once written). */
function requireExistsDeltaIdOnTarget(head: Head, kind: 'element' | 'relationship', subjectId: UUID, seq: number, situation: string): UUID {
  const existsDeltaId = kind === 'element' ? head.elements.get(subjectId)?.existsDeltaId : head.relationships.get(subjectId)?.existsDeltaId;
  if (existsDeltaId === undefined) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: ${situation} — ${subjectId} was not found on the target branch's current head (TARGET_RETRACTED)`);
  return existsDeltaId;
}

function decisionDetailAttributes(detail: CandidateDecisionDetail | null, seq: number): Record<string, unknown> {
  if (detail !== null && 'attributes' in detail) return detail.attributes;
  throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: 'edited' needs decisionDetail.attributes`);
}

function decisionDetailAcceptedAttributes(detail: CandidateDecisionDetail | null, seq: number): readonly string[] {
  if (detail !== null && 'acceptedAttributes' in detail) return detail.acceptedAttributes;
  throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: 'split' needs decisionDetail.acceptedAttributes`);
}

function pick(attributes: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, Json> {
  const result: Record<string, Json> = {};
  for (const key of keys) if (key in attributes) result[key] = attributes[key] as Json;
  return result;
}

export function buildPromotionEnvelope(input: BuildPromotionEnvelopeInput): BuildPromotionEnvelopeResult {
  const { candidates, draftHead, targetHead, reviewerSourceId, mintId } = input;
  const deltas: Delta[] = [];
  const promotedSubjectIdBySeq = new Map<number, UUID>();
  const aliasRows: AliasRowToInsert[] = [];
  const resolvedConflicts: ResolvedConflictToInsert[] = [];
  /** Maps a candidate's own `draftSubjectId` to its real, promoted id — filled by the first pass below, read by every later reference (a co-promoted parent, a relationship endpoint). */
  const promotedIdByDraftId = new Map<UUID, UUID>();

  function resolveRef(ref: CandidateRef | null, seq: number, field: string): UUID | null {
    if (ref === null) return null;
    if (ref.kind !== 'existing') throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: ${field} is not resolved (${ref.kind})`);
    const remapped = promotedIdByDraftId.get(ref.elementId);
    // A remapped id was just minted by this same apply call (pass 1, above)
    // — it can never be in `targetHead` yet (that's the *pre*-commit head),
    // so it's trusted outright. Anything else must already be a real,
    // live element on the target — a genuinely pre-existing reference, or
    // a broken one (an unpromoted/rejected draft id) this check catches.
    if (remapped !== undefined) return remapped;
    if (!targetHead.elements.has(ref.elementId)) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: ${field} (${ref.elementId}) was not found on the target branch — either it wasn't promoted in this same apply call, or it no longer exists there`, ref.elementId);
    return ref.elementId;
  }

  /**
   * A `uses`/`flows_to` edge's `via` is an element id inside its attributes, not one of the edge's own `from`/`to` refs — so `resolveRef` never saw it. Left as the draft id, an import that creates the integration platform and a flow through it in one go would write an edge whose `via` names an element that was never created (C18 rejects it when the commit is folded). Remapped here the same way an endpoint is; an id that isn't a draft id (a platform already in the model) passes through untouched.
   */
  function remapVia<T extends Record<string, unknown>>(attributes: T): T {
    const via = attributes.via;
    if (typeof via !== 'string') return attributes;
    const remapped = promotedIdByDraftId.get(via);
    return remapped === undefined ? attributes : { ...attributes, via: remapped };
  }

  // Pass 1 — element candidates only: assign every promoted candidate's
  // real subject id before any delta is built, so a later reference to it
  // (this call's own order, not the candidates' own `seq`) always resolves.
  for (const candidate of candidates) {
    if (candidate.decision === null || candidate.decision === 'rejected') continue;
    if (candidate.proposal.kind !== 'element') continue;

    if (candidate.class === 'invalid' || candidate.class === 'unsourced') {
      if (candidate.decision !== 'edited') throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: class ${candidate.class} only accepts 'edited' or 'rejected' (SPEC §10)`);
      throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: 'edited' on an ${candidate.class} candidate needs re-grounding (src/capture/ground.ts, PR11) — not yet supported`);
    }

    // duplicate_in_target (issue #285): no draft delta ever existed for this candidate — 'rejected' (already
    // continue'd above) is the only legal decision; the review UI never offers any other action for this class.
    if (candidate.class === 'duplicate_in_target') {
      throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: class duplicate_in_target only accepts 'rejected' (SPEC §10)`);
    }

    if (candidate.decision === 'merged') {
      if (candidate.class !== 'new') throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: 'merged' only applies to a 'new' candidate (SPEC §10)`);
      const detail = candidate.decisionDetail;
      if (detail === null || !('intoElementId' in detail)) throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: 'merged' needs decisionDetail.intoElementId`);
      if (!targetHead.elements.has(detail.intoElementId)) throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: merge target ${detail.intoElementId} was not found on the target branch (TARGET_RETRACTED)`, detail.intoElementId);
      if (candidate.draftSubjectId !== null) promotedIdByDraftId.set(candidate.draftSubjectId, detail.intoElementId);
      // A merge still "promotes" — its own attributes land as updates
      // against the chosen element — so `promoted_subject_id` records that
      // element, matching the schema's own doc comment ("the re-minted id
      // (K-4), or the matched/merged-into existing id").
      promotedSubjectIdBySeq.set(candidate.seq, detail.intoElementId);
      continue;
    }

    if (candidate.class === 'new' || (candidate.class === 'ambiguous' && (candidate.decisionDetail === null || !('intoElementId' in candidate.decisionDetail)))) {
      // A fresh id: a plain `new` candidate, or an `ambiguous` one the
      // reviewer chose "none of these" for (no `intoElementId` — SPEC §10's
      // `n` key) rather than an existing target.
      const promotedId = mintId();
      if (candidate.draftSubjectId !== null) promotedIdByDraftId.set(candidate.draftSubjectId, promotedId);
      promotedSubjectIdBySeq.set(candidate.seq, promotedId);
      continue;
    }

    // Matched (update/confirm/conflict/gone, or ambiguous with a chosen
    // target): the promoted subject is the real element the draft already
    // matched — never re-minted.
    const subjectId = candidate.class === 'ambiguous' && candidate.decisionDetail !== null && 'intoElementId' in candidate.decisionDetail ? candidate.decisionDetail.intoElementId : candidate.draftSubjectId;
    if (subjectId === null) throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: a matched candidate needs a resolved subject id`);
    if (!targetHead.elements.has(subjectId)) throw new BuildPromotionEnvelopeError(candidate.seq, `seq ${String(candidate.seq)}: matched element ${subjectId} was not found on the target branch (TARGET_RETRACTED)`, subjectId);
    promotedSubjectIdBySeq.set(candidate.seq, subjectId);
  }

  // Pass 2 — element deltas.
  for (const candidate of candidates) {
    if (candidate.decision === null || candidate.decision === 'rejected' || candidate.proposal.kind !== 'element') continue;
    const proposal = candidate.proposal;
    const elementType = proposal.elementType;
    const seq = candidate.seq;

    // `accepted`/`split` on `gone`: the retirement update (system) or
    // retract (anything else), confidence 0.50, exactly as staged.
    // `edited` on `gone` (§10: "e.g. set plannedEnd instead") is NOT this
    // shape at all — the reviewer can replace the retirement with an
    // update to *any* attribute — so it falls through to the ordinary
    // per-attribute `edited` handling below instead of being special-cased
    // here.
    if (candidate.class === 'gone' && candidate.decision !== 'edited') {
      const subjectId = promotedSubjectIdBySeq.get(seq);
      if (subjectId === undefined) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: internal — 'gone' candidate has no promoted subject id`);
      const existsDeltaId = requireExistsDeltaIdOnTarget(targetHead, 'element', subjectId, seq, `'gone' candidate ${subjectId}`);
      const draftSubjectId = candidate.draftSubjectId ?? subjectId;
      if (isSystemLikeType(elementType)) {
        const attribute = 'lifecycleStatus';
        const previousDeltaId = targetHead.facts.get(factMapKey(subjectId, attribute))?.deltaId ?? existsDeltaId;
        const provenance = { ...provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, attribute), seq, `${subjectId}.${attribute}`), confidence: GONE_CONFIDENCE };
        deltas.push({ kind: 'element.update', id: mintId(), elementId: subjectId, elementType, attribute, value: 'retired', previousDeltaId, ...provenance } as never);
      } else {
        const provenance = { ...provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE), seq, `${subjectId}.$exists`), confidence: GONE_CONFIDENCE };
        deltas.push({ kind: 'element.retract', id: mintId(), elementId: subjectId, elementType, previousDeltaId: existsDeltaId, ...provenance } as never);
      }
      continue;
    }

    if (candidate.class === 'new' || (candidate.class === 'ambiguous' && !promotedIdByDraftIdIsMatch(candidate))) {
      // Only reached for a genuinely-new create (a plain `new`, or an
      // `ambiguous` the reviewer sent down the "treat as new" path) —
      // `merged` was already fully handled in pass 1 (no create at all).
      if (candidate.decision === 'merged') continue;
      const elementId = promotedSubjectIdBySeq.get(seq);
      if (elementId === undefined) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: internal — 'new'-shaped candidate has no promoted subject id`);
      const parentId = resolveRef(proposal.parent, seq, 'parent');
      const draftSubjectId = candidate.draftSubjectId;
      if (draftSubjectId === null) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: a 'new'-shaped candidate needs a resolved draftSubjectId`);

      let attributes: Record<string, Json>;
      let provenance: { sourceId: UUID; sourceRef?: string; effectiveDate?: string; confidence: number };
      if (candidate.decision === 'edited') {
        attributes = decisionDetailAttributes(candidate.decisionDetail, seq) as Record<string, Json>;
        provenance = editedProvenance(reviewerSourceId);
      } else if (candidate.decision === 'split') {
        attributes = pick(proposal.attributes, decisionDetailAcceptedAttributes(candidate.decisionDetail, seq));
        provenance = provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE), seq, `${draftSubjectId}.$exists`);
      } else {
        attributes = proposal.attributes;
        provenance = provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE), seq, `${draftSubjectId}.$exists`);
      }

      const delta = { kind: 'element.create', id: mintId(), elementId, elementType, name: proposal.name, parentId, attributes, ...provenance } as never as Delta;
      deltas.push(delta);
      if (candidate.decision === 'edited') resolvedConflicts.push({ id: mintId(), winningDeltaId: (delta as { id: UUID }).id, discardedDeltaId: draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE)?.deltaId ?? requireExistsDeltaId(draftHead, 'element', draftSubjectId, seq, `draft candidate ${draftSubjectId}`), rationale: null });
      continue;
    }

    // update / confirm / conflict / ambiguous-with-a-chosen-target — one
    // element.update per attribute, previousDeltaId re-derived against the
    // target, provenance carried from the draft (or reviewer-supplied for
    // 'edited').
    const subjectId = promotedSubjectIdBySeq.get(seq);
    if (subjectId === undefined) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: internal — matched candidate has no promoted subject id`);
    const existsDeltaId = requireExistsDeltaIdOnTarget(targetHead, 'element', subjectId, seq, `matched element ${subjectId}`);
    const draftSubjectId = candidate.draftSubjectId ?? subjectId;
    const sourceAttributes: Record<string, unknown> = candidate.decision === 'edited' ? decisionDetailAttributes(candidate.decisionDetail, seq) : candidate.decision === 'split' ? pick(proposal.attributes, decisionDetailAcceptedAttributes(candidate.decisionDetail, seq)) : (proposal.attributes);

    for (const attribute of Object.keys(sourceAttributes).sort()) {
      const value = sourceAttributes[attribute] as Json;
      const previousDeltaId = targetHead.facts.get(factMapKey(subjectId, attribute))?.deltaId ?? existsDeltaId;
      const provenance = candidate.decision === 'edited' ? editedProvenance(reviewerSourceId) : provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, attribute), seq, `${draftSubjectId}.${attribute}`);
      const delta = { kind: 'element.update', id: mintId(), elementId: subjectId, elementType, attribute, value, previousDeltaId, ...provenance } as never as Delta;
      deltas.push(delta);
      if (candidate.decision === 'edited') resolvedConflicts.push({ id: mintId(), winningDeltaId: (delta as { id: UUID }).id, discardedDeltaId: draftFact(draftHead, draftSubjectId, attribute)?.deltaId ?? existsDeltaId, rationale: null });
    }

    // §7.6: a level-3 match that's actually being promoted (not a fresh
    // create) earns the document's own exact name as a `name` alias.
    if (candidate.match.level === 'name_context') {
      aliasRows.push({ id: mintId(), elementId: subjectId, aliasValue: proposal.name, aliasType: 'name', sourceId: provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE), seq, `${draftSubjectId}.$exists`).sourceId, confidence: matchConfidenceFor(candidate.match) });
    }
  }

  // §7.6: a `merged` candidate's own name, as an alias on the element it merged into.
  for (const candidate of candidates) {
    if (candidate.decision !== 'merged' || candidate.proposal.kind !== 'element' || candidate.draftSubjectId === null) continue;
    const detail = candidate.decisionDetail;
    if (detail === null || !('intoElementId' in detail)) continue;
    const existsFact = draftFact(draftHead, candidate.draftSubjectId, EXISTS_ATTRIBUTE);
    aliasRows.push({ id: mintId(), elementId: detail.intoElementId, aliasValue: candidate.proposal.name, aliasType: 'name', sourceId: existsFact?.sourceId ?? reviewerSourceId, confidence: 1 });

    // The merged candidate's own attributes become updates against the chosen existing element, one per differing attribute.
    const existsDeltaId = requireExistsDeltaIdOnTarget(targetHead, 'element', detail.intoElementId, candidate.seq, `merge target ${detail.intoElementId}`);
    for (const attribute of Object.keys(candidate.proposal.attributes).sort()) {
      const value = (candidate.proposal.attributes as Record<string, Json>)[attribute];
      const currentValue = targetHead.facts.get(factMapKey(detail.intoElementId, attribute))?.value;
      if (currentValue !== undefined && JSON.stringify(currentValue) === JSON.stringify(value)) continue; // "one per attribute whose value differs" — SPEC §8.2's own table.
      const previousDeltaId = targetHead.facts.get(factMapKey(detail.intoElementId, attribute))?.deltaId ?? existsDeltaId;
      const provenance = provenanceFromDraftFact(draftFact(draftHead, candidate.draftSubjectId, attribute), candidate.seq, `${candidate.draftSubjectId}.${attribute}`);
      deltas.push({ kind: 'element.update', id: mintId(), elementId: detail.intoElementId, elementType: candidate.proposal.elementType, attribute, value, previousDeltaId, ...provenance } as never);
    }
  }

  // Pass 3 — relationship candidates: endpoints resolved against `promotedIdByDraftId` first, the target's own live elements otherwise.
  for (const candidate of candidates) {
    if (candidate.decision === null || candidate.decision === 'rejected' || candidate.proposal.kind !== 'relationship') continue;
    const proposal = candidate.proposal;
    const relationshipType = proposal.relationshipType;
    const seq = candidate.seq;

    if (candidate.class === 'gone') throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: a relationship candidate can never be class 'gone' (SPEC-capture.md §4.4)`);
    if (candidate.decision === 'merged') throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: 'merged' never applies to a relationship candidate (SPEC §10)`);
    if (candidate.class === 'invalid' || candidate.class === 'unsourced') {
      if (candidate.decision !== 'edited') throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: class ${candidate.class} only accepts 'edited' or 'rejected' (SPEC §10)`);
      throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: 'edited' on an ${candidate.class} candidate needs re-grounding (src/capture/ground.ts, PR11) — not yet supported`);
    }
    // duplicate_in_target is only ever produced for element candidates (resolveElementCandidate) — never a
    // relationship — but this defends the shared CandidateClass union the same way regardless.
    if (candidate.class === 'duplicate_in_target') {
      throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: class duplicate_in_target only accepts 'rejected' (SPEC §10)`);
    }

    if (candidate.class === 'new') {
      const relationshipId = mintId();
      const fromElementId = resolveRef(proposal.from, seq, 'from');
      const toElementId = resolveRef(proposal.to, seq, 'to');
      if (fromElementId === null || toElementId === null) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: a relationship needs resolved from/to endpoints`);
      const draftSubjectId = candidate.draftSubjectId;
      if (draftSubjectId === null) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: a 'new' relationship candidate needs a resolved draftSubjectId`);
      promotedSubjectIdBySeq.set(seq, relationshipId);

      let attributes: Record<string, Json>;
      let provenance: { sourceId: UUID; sourceRef?: string; effectiveDate?: string; confidence: number };
      if (candidate.decision === 'edited') {
        attributes = decisionDetailAttributes(candidate.decisionDetail, seq) as Record<string, Json>;
        provenance = editedProvenance(reviewerSourceId);
      } else if (candidate.decision === 'split') {
        attributes = pick(proposal.attributes as unknown as Record<string, unknown>, decisionDetailAcceptedAttributes(candidate.decisionDetail, seq));
        provenance = provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE), seq, `${draftSubjectId}.$exists`);
      } else {
        attributes = proposal.attributes as unknown as Record<string, Json>;
        provenance = provenanceFromDraftFact(draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE), seq, `${draftSubjectId}.$exists`);
      }

      attributes = remapVia(attributes);
      const delta = { kind: 'relationship.create', id: mintId(), relationshipId, relationshipType, fromElementId, toElementId, attributes, ...provenance } as never as Delta;
      deltas.push(delta);
      if (candidate.decision === 'edited') resolvedConflicts.push({ id: mintId(), winningDeltaId: (delta as { id: UUID }).id, discardedDeltaId: draftFact(draftHead, draftSubjectId, EXISTS_ATTRIBUTE)?.deltaId ?? requireExistsDeltaId(draftHead, 'relationship', draftSubjectId, seq, `draft candidate ${draftSubjectId}`), rationale: null });

      // Sprint F2b, Step 4 (SPEC-capture.md §5.6): a JSON changes-section
      // `replaced_by` is promoted as an ordinary `replaces` candidate
      // (built in `runCapture.ts`'s `buildJsonChangeCandidates`) — being
      // promoted `new` here is what triggers the retiring element's
      // (`toElementId`) own supports-edge transfer to the replacement
      // (`fromElementId`), the same shape `useElementRetire.ts`'s own
      // "replaced by" picker already uses: every live `supports` edge is
      // retracted and re-created from the replacement at `role: 'secondary'`,
      // carrying over `description` if any. Same provenance as the
      // `replaces` delta itself — the transfer is a mechanical consequence
      // of promoting that one fact, not a separately-sourced assertion.
      // Scoped to `new` only (not `edited`/`split`, and not a re-asserted
      // `update`/`confirm` below): a re-import re-promoting the same
      // `replaces` edge finds no live `supports` edges left to transfer
      // regardless, since the first promotion already retracted them.
      if (relationshipType === 'replaces') {
        for (const [edgeId, edge] of targetHead.relationships) {
          if (edge.relationshipType !== 'supports' || edge.fromElementId !== toElementId) continue;
          const existsFactDeltaId = targetHead.facts.get(factMapKey(edgeId, EXISTS_ATTRIBUTE))?.deltaId ?? edge.existsDeltaId;
          deltas.push({ kind: 'relationship.retract', id: mintId(), relationshipId: edgeId, relationshipType: 'supports', previousDeltaId: existsFactDeltaId, ...provenance } as never);
          const description = (edge.attributes as Record<string, unknown>).description;
          const transferredAttributes: Record<string, Json> = typeof description === 'string' && description.trim() !== '' ? { role: 'secondary', description } : { role: 'secondary' };
          deltas.push({ kind: 'relationship.create', id: mintId(), relationshipId: mintId(), relationshipType: 'supports', fromElementId, toElementId: edge.toElementId, attributes: transferredAttributes, ...provenance } as never);
        }
      }
      continue;
    }

    // update / confirm / conflict.
    const subjectId = candidate.draftSubjectId;
    if (subjectId === null) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: a matched relationship candidate needs a resolved draftSubjectId`);
    if (!targetHead.relationships.has(subjectId)) throw new BuildPromotionEnvelopeError(seq, `seq ${String(seq)}: matched relationship ${subjectId} was not found on the target branch (TARGET_RETRACTED)`, subjectId);
    promotedSubjectIdBySeq.set(seq, subjectId);
    const existsDeltaId = requireExistsDeltaIdOnTarget(targetHead, 'relationship', subjectId, seq, `matched relationship ${subjectId}`);
    const sourceAttributes: Record<string, unknown> = remapVia(candidate.decision === 'edited' ? decisionDetailAttributes(candidate.decisionDetail, seq) : candidate.decision === 'split' ? pick(proposal.attributes as unknown as Record<string, unknown>, decisionDetailAcceptedAttributes(candidate.decisionDetail, seq)) : (proposal.attributes as unknown as Record<string, unknown>));

    for (const attribute of Object.keys(sourceAttributes).sort()) {
      const value = sourceAttributes[attribute] as Json;
      const previousDeltaId = targetHead.facts.get(factMapKey(subjectId, attribute))?.deltaId ?? existsDeltaId;
      const provenance = candidate.decision === 'edited' ? editedProvenance(reviewerSourceId) : provenanceFromDraftFact(draftFact(draftHead, subjectId, attribute), seq, `${subjectId}.${attribute}`);
      const delta = { kind: 'relationship.update', id: mintId(), relationshipId: subjectId, relationshipType, attribute, value, previousDeltaId, ...provenance } as never as Delta;
      deltas.push(delta);
      if (candidate.decision === 'edited') resolvedConflicts.push({ id: mintId(), winningDeltaId: (delta as { id: UUID }).id, discardedDeltaId: draftFact(draftHead, subjectId, attribute)?.deltaId ?? existsDeltaId, rationale: null });
    }
  }

  function promotedIdByDraftIdIsMatch(candidate: CaptureCandidate): boolean {
    return candidate.decisionDetail !== null && 'intoElementId' in candidate.decisionDetail;
  }

  return { deltas, promotedSubjectIdBySeq, aliasRows, resolvedConflicts };
}
