/**
 * F2 (full K1) PR9, SPEC-capture.md §9.2: compares this run's own
 * candidate set against the previous job's `capture_candidates` (by
 * `row_key`, §9.1) when `capture_jobs.reimport_of_job_id` is set. Two
 * separate outputs, matching the two things §9.2's own table does:
 *
 * 1. `reimportStatus` for every candidate *this run* produced — 'new'
 *    (no previous row shared this key), 'changed' (a previous row did,
 *    and at least one proposed attribute value differs from what that
 *    row's own proposal said), or 'unchanged' (same key, no attribute
 *    differs). This is purely informational (§9.2: "the diff is
 *    informational; class is still decided against main's current
 *    facts") — `classify.ts` (PR2) already assigned the real §4.4 class
 *    from main's own state, independently of this comparison.
 * 2. Brand-new `gone` candidates (K-14) for previous rows that vanished:
 *    present last time, absent this time, and *only* when that previous
 *    row was actually accepted into the model last time (`accepted`,
 *    `merged`, or `edited` — "a row the reviewer rejected last quarter
 *    and that has since vanished is not news"). Never for a relationship:
 *    §4.4's own class table lists `gone` as element-only.
 *
 * A `gone` row needs a live target on *main* to retire — this module
 * re-matches it there itself, against the *whole* pool of main elements
 * of that type, since main may have moved since the previous run and the
 * previous candidate's own `draftSubjectId`/`promotedSubjectId` says
 * nothing about whether (or under what id) that change ever reached
 * main. A previous row that no longer matches anything on main
 * (retracted, renamed past recognition) has nothing left to retire —
 * silently produces no `gone` candidate, the same "nothing to report" as
 * never having matched at all. Deliberately scoped to trigram name
 * matching only (`resolveByTrigram`, PR2's own `match.ts`) — no
 * `atlasId`/alias lookup (a persisted `CaptureCandidate.proposal` carries
 * neither the original `atlasId` nor its source keys —
 * `RowCandidate.matchHints`, PR5's own pre-orchestration shape, is never
 * persisted) and, deliberately, no parent-context filtering either:
 * `matchElement`'s own context tier would need the previous row's parent
 * *id*, not just its name, which is equally unavailable this far removed
 * from the run that proposed it — `capabilityAssignment.ts`'s own
 * "search the whole tree regardless of level/parent" reasoning applies
 * here for the identical reason, generalised from capabilities to every
 * element type a `gone` row can be. Disclosed, not silently approximated.
 */
import type { CandidateDecision, CandidateEvidence, CandidateProposal, CandidateReimportStatus, MatchOutcome } from '../contracts/capture';
import type { ElementType, RelationshipType } from '../contracts/delta';
import { deepEqualJson } from './classify';
import { GONE_CONFIDENCE } from './confidence';
import { resolveByTrigram } from './match';
import type { MatchIndex } from './matchIndex';

export interface ThisRunCandidateForDiff {
  rowKey: string;
  proposal: CandidateProposal;
}

export interface PreviousCandidateForDiff {
  rowKey: string;
  kind: 'element' | 'relationship';
  elementType: ElementType | null;
  relationshipType: RelationshipType | null;
  proposal: CandidateProposal;
  evidence: CandidateEvidence;
  decision: CandidateDecision | null;
}

/** A synthesized `gone` candidate — everything the caller needs to finish assembling a real `CaptureCandidate` row (seq, ids) around it. */
export interface GoneCandidate {
  rowKey: string;
  elementType: ElementType;
  /** Always the previous row's own proposed name — `buildCaptureDraftEnvelope.ts` (PR7) never reads a `gone` candidate's own `proposal` for anything else. */
  proposal: CandidateProposal;
  match: MatchOutcome;
  evidence: CandidateEvidence;
  /** K-14: fixed, not derived — a retirement inferred from absence, never a document-stated fact with its own confidence. */
  confidence: typeof GONE_CONFIDENCE;
}

export interface ReimportDiffResult {
  /** Every one of this run's own candidates gets an entry — 'new' when nothing else applies. */
  reimportStatusByRowKey: ReadonlyMap<string, CandidateReimportStatus>;
  goneCandidates: readonly GoneCandidate[];
}

const ACCEPTED_LAST_TIME: ReadonlySet<CandidateDecision> = new Set(['accepted', 'merged', 'edited']);

/** §9.2: "evidence = the previous run's passage, sourceRef = the previous run's ref with a reimport-diff extractor" — `sourceRef`/`passage` carried over verbatim (they already locate exactly where the row used to be), only `extractor` changes. */
function reimportDiffEvidence(previous: CandidateEvidence): CandidateEvidence {
  return { ...previous, extractor: 'reimport-diff' };
}

export function diffAgainstPreviousImport(thisRun: readonly ThisRunCandidateForDiff[], previous: readonly PreviousCandidateForDiff[], matchIndex: MatchIndex): ReimportDiffResult {
  const previousByRowKey = new Map(previous.map((p) => [p.rowKey, p]));
  const thisRunRowKeys = new Set(thisRun.map((c) => c.rowKey));

  const reimportStatusByRowKey = new Map<string, CandidateReimportStatus>();
  for (const candidate of thisRun) {
    const prior = previousByRowKey.get(candidate.rowKey);
    if (!prior) {
      reimportStatusByRowKey.set(candidate.rowKey, 'new');
      continue;
    }
    const changed = !deepEqualJson(candidate.proposal.attributes, prior.proposal.attributes);
    reimportStatusByRowKey.set(candidate.rowKey, changed ? 'changed' : 'unchanged');
  }

  const goneCandidates: GoneCandidate[] = [];
  for (const prior of previous) {
    if (thisRunRowKeys.has(prior.rowKey)) continue; // still present.
    if (prior.kind !== 'element' || prior.elementType === null || prior.proposal.kind !== 'element') continue; // §4.4: gone is element-only.
    if (prior.decision === null || !ACCEPTED_LAST_TIME.has(prior.decision)) continue; // rejected/undecided last time — not news.

    const pool = matchIndex.elementsByType.get(prior.elementType) ?? [];
    const trigram = resolveByTrigram(prior.proposal.name, pool);
    if (trigram.level === 'none') continue; // nothing left on main to retire.
    const match: MatchOutcome = { ...trigram, warnings: [] };

    goneCandidates.push({
      rowKey: prior.rowKey,
      elementType: prior.elementType,
      proposal: prior.proposal,
      match,
      evidence: reimportDiffEvidence(prior.evidence),
      confidence: GONE_CONFIDENCE,
    });
  }

  return { reimportStatusByRowKey, goneCandidates };
}
