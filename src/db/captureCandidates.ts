/**
 * F2 (full K1) PR15: `capture_candidates` reads plus thin client wrappers
 * for `atlas.stage_capture_decisions`/`atlas.apply_capture_decisions`
 * (PR8's own migration and RPC signatures — until now only called inline
 * from `applyCaptureDecisions.integration.test.ts`; this is the first real
 * client-side wrapper). Same untyped-client boundary as every other
 * repository here (`captureJobs.ts`'s own module comment).
 */
import type { UUID } from '../contracts/delta';
import type { CandidateDecision, CandidateDecisionDetail, CaptureCandidate } from '../contracts/capture';
import { captureCandidateRowToWire } from '../contracts/capture';
import type { DeltaRow } from '../contracts/rows';
import type { Client } from './client';
import type { CaptureCandidateRow } from './types';

/** Every candidate for one job, in `seq` order (§8.1: the order they were written in) — the review queue's own list read. */
export async function listCaptureCandidates(supabase: Client, jobId: UUID): Promise<CaptureCandidate[]> {
  const { data, error } = await supabase.from('capture_candidates').select('*').eq('job_id', jobId).order('seq');
  if (error) throw new Error(`listCaptureCandidates: ${error.message}`);
  return ((data as CaptureCandidateRow[] | null) ?? []).map(captureCandidateRowToWire);
}

export interface CaptureDecisionInput {
  candidateId: UUID;
  /** `null` is `u` (undo) — SPEC §8.2: "stages `decision = null`", also nulling `decided_by`/`decided_at` server-side. */
  decision: CandidateDecision | null;
  decisionDetail: CandidateDecisionDetail | null;
}

/**
 * `atlas.stage_capture_decisions` — one call per reviewer action (SPEC §8.2:
 * "staged decisions survive a reload server-side... the UI's own local copy
 * agrees because the draft head never moves after write"), never batched
 * behind a single flush button. Contributor+, requires `capture_jobs.status
 * = 'parsed'`.
 */
export async function stageCaptureDecisions(supabase: Client, jobId: UUID, decisions: readonly CaptureDecisionInput[]): Promise<void> {
  const payload = decisions.map((d) => ({ candidate_id: d.candidateId, decision: d.decision, decision_detail: d.decisionDetail }));
  const { error } = await supabase.schema('atlas').rpc('stage_capture_decisions', { p_job_id: jobId, p_decisions: payload });
  if (error) throw new Error(`stageCaptureDecisions: ${error.message}`);
}

export interface AliasRowInput {
  id: UUID;
  elementId: UUID;
  aliasValue: string;
  aliasType: 'name';
  sourceId: UUID;
  confidence: number;
}

export interface ResolvedConflictInput {
  id: UUID;
  winningDeltaId: UUID;
  discardedDeltaId: UUID;
  rationale: string | null;
}

export interface CandidateOutcomeInput {
  candidateId: UUID;
  promotedSubjectId: UUID;
}

export interface ApplyCaptureDecisionsInput {
  jobId: UUID;
  targetBranchId: UUID;
  commitId: UUID;
  commitTitle: string;
  commitBody: string | null;
  deltas: readonly DeltaRow[];
  aliasRows: readonly AliasRowInput[];
  candidateOutcomes: readonly CandidateOutcomeInput[];
  resolvedConflicts: readonly ResolvedConflictInput[];
  stats: Record<string, unknown>;
}

/**
 * `atlas.apply_capture_decisions` — one atomic commit onto the reviewer's
 * chosen target `change` branch (P-K6: all-or-nothing). The caller decides
 * which candidates go into this call's own `deltas`/`candidateOutcomes`
 * (`src/capture/buildPromotionEnvelope.ts`'s own module comment: "every
 * candidate being acted on in this apply call") — passing only the
 * decided-but-not-yet-promoted ones supports calling this more than once as
 * a job is worked through incrementally; `capture_jobs.status` only flips
 * to `reviewed` once every candidate, across every call, has a decision.
 */
export async function applyCaptureDecisions(supabase: Client, input: ApplyCaptureDecisionsInput): Promise<{ id: UUID }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('apply_capture_decisions', {
    p_job_id: input.jobId,
    p_target_branch_id: input.targetBranchId,
    p_commit_id: input.commitId,
    p_commit_title: input.commitTitle,
    p_commit_body: input.commitBody,
    p_deltas: input.deltas,
    p_alias_rows: input.aliasRows.map((a) => ({ id: a.id, element_id: a.elementId, alias_value: a.aliasValue, alias_type: a.aliasType, source_id: a.sourceId, confidence: a.confidence })),
    p_candidate_outcomes: input.candidateOutcomes.map((c) => ({ candidate_id: c.candidateId, promoted_subject_id: c.promotedSubjectId })),
    p_resolved_conflicts: input.resolvedConflicts.map((r) => ({ id: r.id, winning_delta_id: r.winningDeltaId, discarded_delta_id: r.discardedDeltaId, resolution_delta_id: null, rationale: r.rationale })),
    p_stats: input.stats,
  });
  if (error) throw new Error(`applyCaptureDecisions: ${error.message}`);
  return data as { id: UUID };
}
