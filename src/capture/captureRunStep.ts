/**
 * F2 (full K1) PR12, SPEC-capture.md §3.5/§8.1 (K-12): the one step
 * `supabase/functions/capture-run/index.ts` runs per invocation. Lives in
 * `src/capture` (not the edge function itself) so it's the same Vitest-
 * testable TypeScript the edge function imports directly (K-15) — every
 * piece of real I/O (reading the job, folding main's head, downloading the
 * input, calling the LLM, writing the draft) is an injected `CaptureRunDeps`
 * function, so this module's own tests run against a fake DB layer with no
 * Deno runtime, no network, no Supabase project at all.
 *
 * **K-12's resumability, narrowed (agreed with the human on PR12's own
 * planning turn).** K-12 asks for chunk-level resumability: bounded
 * (≤ 60 s) invocations, `progress.done`/`total` advancing per chunk, a
 * crash resuming from the last completed chunk. `runCapture()` (PR10/PR11)
 * is not internally chunked that way — it parses, extracts and matches an
 * entire document in one call, and `capture_jobs.progress` has no field to
 * stash a partial candidate set in even if it were. There is also nowhere
 * to persist a partial result between two invocations short of a schema
 * change this PR doesn't make. So this module implements **job-level retry
 * only**: one invocation does parse→extract→match→write in full, or fails
 * outright; nothing is written to `branches`/`commits`/`deltas`/
 * `capture_candidates` until the one atomic `write_capture_draft` call at
 * the very end, so a crash mid-run loses no data — a retry (calling this
 * again with the same `jobId`) simply reruns the whole thing. `progress`
 * still reports which coarse phase is running (useful for a live "…"
 * indicator), but never advances `done`/`total` mid-phase and is never
 * read back to resume from partway through. K-12's own `{status: 'continue'}`
 * is consequently never returned here — there is no sub-step to continue
 * into; a caller that gets `'failed'` (or sees the invocation simply not
 * return, e.g. a platform timeout) re-invokes with the same `jobId` to
 * retry from scratch, which `runCaptureRunStep` treats as an ordinary retry
 * of a `pending` job with a stale `error`.
 *
 * This module is also genuinely idempotent, which is a real (if smaller)
 * form of resumability worth its own tests: calling it again on a job
 * that's already `parsed`/`reviewed`/`discarded` is a safe no-op — it never
 * re-runs the pipeline or double-writes a draft.
 */
import type { CaptureCandidate, CaptureJobError, CaptureJobProgress, CaptureStatus } from '../contracts/capture';
import { captureCandidateWireToRow, type CaptureCandidateRowShape } from '../contracts/capture';
import { envelopeToDeltaRows, type DeltaRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { cloneHead, fold, type Head } from '../engine/deltas';
import { buildCaptureDraftEnvelope, candidateDeltaRank } from './buildCaptureDraftEnvelope';
import type { LlmClient } from './llm/client';
import type { MatchIndex } from './matchIndex';
import type { PreviousCandidateForDiff } from './reimportDiff';
import { runCapture, type ResolvedCandidate, type RunCaptureSource } from './runCapture';

export interface CaptureRunJob {
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  inputKind: 'spreadsheet' | 'pdf' | 'text';
  inputName: string;
  /** §3.4: the `capture-inputs` Storage object this job's own input was uploaded/pasted to — `deps.downloadInput` is the only dep that reads it. */
  inputRef: string;
  documentDate: string | null;
  status: CaptureStatus;
  reimportOfJobId: UUID | null;
  /** K-8/§7.1's fifth bullet, issue #285: the change branch the reviewer most recently promoted into (`capture_jobs.target_branch_id`) — when set, matching also checks that branch's own folded head (`deps.foldMainHead`'s own `targetHead`). */
  targetBranchId: UUID | null;
  createdBy: UUID;
}

export interface WriteCaptureDraftInput {
  jobId: UUID;
  branchId: UUID;
  commitId: UUID;
  commitBody: string;
  deltas: readonly DeltaRow[];
  candidates: readonly CaptureCandidateRowShape[];
  stats: Record<string, number>;
}

export interface WriteCaptureDraftOutput {
  branchId: UUID;
}

/**
 * Every piece of real I/O this step needs — a fake in tests, real
 * Postgres/Storage calls in `supabase/functions/capture-run/db.ts`. Every
 * member is declared as an arrow-typed property (`x: (…) => …`), not
 * method shorthand (`x(…): …`) — the two are otherwise equivalent, but a
 * fake built with `vi.fn()` and later referenced bare (`expect(deps.readJob)`)
 * only avoids `@typescript-eslint/unbound-method` false positives in the
 * first form, since nothing here ever actually depends on a `this` binding.
 */
export interface CaptureRunDeps {
  readJob: (jobId: UUID) => Promise<CaptureRunJob | null>;
  /** Clears `error` and sets `progress` in one write — the start of every attempt, first or retried. */
  beginAttempt: (jobId: UUID, progress: CaptureJobProgress) => Promise<void>;
  setProgress: (jobId: UUID, progress: CaptureJobProgress) => Promise<void>;
  setError: (jobId: UUID, error: CaptureJobError) => Promise<void>;
  buildMatchIndex: (modelId: UUID) => Promise<MatchIndex>;
  /** Main's current head_commit_id and its own folded `Head` — `null` head only for a model with no commits at all, which ADR-018 says cannot happen; a real implementation may still choose to guard it defensively. `targetHead` (issue #285): the job's own `targetBranchId`'s folded head when set, else `null` — never read when `targetBranchId` is `null`. */
  foldMainHead: (modelId: UUID, targetBranchId: UUID | null) => Promise<{ mainHeadCommitId: UUID; head: Head; targetHead: Head | null }>;
  /** `[]` when the job has no `reimportOfJobId`. */
  readReimportPrevious: (previousJobId: UUID) => Promise<PreviousCandidateForDiff[]>;
  /** §3.1: the run's own `sources` row — created once per job (`source` names it: the file's own name, or a preview of the pasted text); a retried attempt reuses the row a previous, interrupted attempt already created rather than minting a second one. */
  getOrCreateJobSource: (job: CaptureRunJob, source: RunCaptureSource) => Promise<UUID>;
  downloadInput: (job: CaptureRunJob) => Promise<RunCaptureSource>;
  llmClient: LlmClient;
  /** One shared generator for every id this step mints (branch, commit, deltas, candidate rows, and — via `runCapture()`'s own `mintId` — new element/relationship subject ids) — rule 6: deterministic in tests, `crypto.randomUUID` for real. */
  mintId: () => UUID;
  writeCaptureDraft: (input: WriteCaptureDraftInput) => Promise<WriteCaptureDraftOutput>;
}

export type CaptureRunStepResult =
  | { status: 'parsed'; branchId: UUID; stats: Record<string, number> }
  | { status: 'failed'; error: CaptureJobError }
  /** The job was already `parsed`/`reviewed`/`discarded` — this invocation did nothing (idempotent). */
  | { status: 'noop'; jobStatus: CaptureStatus };

export class CaptureRunStepError extends Error {}

/** §8.1's own summary sentence for `commits.body` — derived from `runCapture()`'s own flat `class.*` stat keys (runCapture.ts's own module comment on why `stats` is flat, not SPEC §8.1's nested illustration). */
function summarizeStats(stats: Readonly<Record<string, number>>): string {
  const total = stats.candidates ?? 0;
  const classOrder = ['new', 'update', 'confirm', 'conflict', 'ambiguous', 'gone', 'invalid', 'unsourced', 'duplicate_in_target'] as const;
  const parts = classOrder.map((cls) => [cls, stats[`class.${cls}`] ?? 0] as const).filter(([, count]) => count > 0);
  const summary = parts.map(([cls, count]) => `${String(count)} ${cls}`).join(', ');
  return summary !== '' ? `${String(total)} candidates: ${summary}.` : `${String(total)} candidates.`;
}

/** §11: maps a thrown error to a job-failure code. `LlmRefusalError`/`LlmTruncatedError`/`LlmSchemaInvalidError` (src/capture/llm/client.ts) carry their own `.code`, read generically rather than one `instanceof` per class. `LLM_UNAVAILABLE` is a best-effort match on `ProxyLlmClient`'s own plain-`Error` message shape (`llm-proxy call failed (status): …`) for a 429/5xx — everything else pipeline-internal (a `RunCaptureError`/`CaptureDraftEnvelopeError`/an engine fold failure/a malformed LLM JSON response) is not one of §11's named document/LLM failure modes, so it gets a disclosed catch-all code instead of a guessed, possibly-misleading one. */
function classifyError(e: unknown): CaptureJobError {
  const message = e instanceof Error ? e.message : String(e);
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') {
    return { code: e.code, message };
  }
  const proxyStatus = /llm-proxy call failed \((\d+)\)/.exec(message)?.[1];
  if (proxyStatus !== undefined) {
    const status = Number(proxyStatus);
    if (status === 429 || status >= 500) return { code: 'LLM_UNAVAILABLE', message };
  }
  return { code: 'CAPTURE_RUN_FAILED', message };
}

function toCaptureCandidate(resolved: ResolvedCandidate, orgId: UUID, jobId: UUID, modelId: UUID, id: UUID, createdAt: string): CaptureCandidate {
  return {
    id,
    orgId,
    jobId,
    modelId,
    seq: resolved.seq,
    kind: resolved.kind,
    class: resolved.class,
    elementType: resolved.elementType,
    relationshipType: resolved.relationshipType,
    draftSubjectId: resolved.draftSubjectId,
    proposal: resolved.proposal,
    evidence: resolved.evidence,
    match: resolved.match,
    confidence: resolved.confidence,
    rowKey: resolved.rowKey,
    reimportStatus: resolved.reimportStatus,
    draftDeltaIds: [],
    aliasProposals: resolved.aliasProposals,
    decision: null,
    decisionDetail: null,
    decidedBy: null,
    decidedAt: null,
    promotedCommitId: null,
    promotedSubjectId: null,
    createdAt,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function progressFor(stage: CaptureJobProgress['stage'], startedAt: string): CaptureJobProgress {
  return { stage, done: 0, total: 1, startedAt, updatedAt: nowIso() };
}

/** One bounded (in the job-level-retry sense described in this module's own comment) invocation of the capture pipeline for one job. */
export async function runCaptureRunStep(deps: CaptureRunDeps, jobId: UUID): Promise<CaptureRunStepResult> {
  const job = await deps.readJob(jobId);
  if (!job) throw new CaptureRunStepError(`runCaptureRunStep: capture job ${jobId} not found.`);
  if (job.status !== 'pending') return { status: 'noop', jobStatus: job.status };

  const startedAt = nowIso();
  await deps.beginAttempt(jobId, progressFor('extract', startedAt));

  try {
    // §3.1: a `text` job's own source name previews the pasted content
    // itself ("Pasted text — {first 60 chars}"), so the source can't be
    // created until the input is in hand — sequenced before the rest,
    // which don't depend on it and run together.
    const source = await deps.downloadInput(job);
    const [matchIndex, { mainHeadCommitId, head: mainHead, targetHead }, reimportPrevious, sourceId] = await Promise.all([
      deps.buildMatchIndex(job.modelId),
      deps.foldMainHead(job.modelId, job.targetBranchId),
      job.reimportOfJobId ? deps.readReimportPrevious(job.reimportOfJobId) : Promise.resolve([]),
      deps.getOrCreateJobSource(job, source),
    ]);

    const runResult = await runCapture({
      inputName: job.inputName,
      source,
      documentDate: job.documentDate,
      llmClient: deps.llmClient,
      matchIndex,
      mainHead,
      ...(targetHead ? { targetHead } : {}),
      ...(reimportPrevious.length > 0 ? { reimportPrevious } : {}),
      mintId: deps.mintId,
    });

    if (runResult.status === 'failed') {
      const error: CaptureJobError = { code: runResult.errorCode, message: runResult.message };
      await deps.setError(jobId, error);
      return { status: 'failed', error };
    }

    await deps.setProgress(jobId, progressFor('write', startedAt));

    const createdAt = nowIso();
    const candidates = runResult.candidates.map((c) => toCaptureCandidate(c, job.orgId, jobId, job.modelId, deps.mintId(), createdAt));

    const branchId = deps.mintId();
    const commitId = deps.mintId();
    const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({
      commitId,
      branchId,
      parentCommitId: mainHeadCommitId,
      title: job.inputName,
      body: null,
      sourceId,
      effectiveDate: job.documentDate,
      mainHead,
      candidates,
      mintId: deps.mintId,
    });

    // §8.1 step 3's own "the worker has already folded the envelope with
    // src/engine to check [C1-C6]" — made fault-tolerant: fold each
    // candidate's own deltas in the same dependency order the envelope used
    // (elements before relationships) and *drop* (mark `invalid`) any
    // candidate the engine rejects, so one bad candidate (a C9/C17/V6
    // violation, or a future bug) only costs that one candidate, never the
    // whole run.
    const workingHead = cloneHead(mainHead);
    const rejectedSeqs = new Set<number>();
    const deltaOrder = [...candidates].sort((a, b) => candidateDeltaRank(a) - candidateDeltaRank(b) || a.seq - b.seq);
    for (const candidate of deltaOrder) {
      const deltaIds = draftDeltaIdsBySeq.get(candidate.seq) ?? [];
      if (deltaIds.length === 0) continue;
      const candidateDeltas = envelope.deltas.filter((d) => deltaIds.includes(d.id));
      try {
        fold(workingHead, candidateDeltas, { authorId: job.createdBy, createdAt });
      } catch {
        rejectedSeqs.add(candidate.seq);
      }
    }

    const rejectedDeltaIds = new Set([...rejectedSeqs].flatMap((seq) => draftDeltaIdsBySeq.get(seq) ?? []));
    const keptEnvelope = { ...envelope, deltas: envelope.deltas.filter((d) => !rejectedDeltaIds.has(d.id)) };
    // `capture_candidates_check3`: `class: 'invalid'` requires `draftSubjectId`
    // null, same as every other path that produces an `invalid` candidate
    // (`runCapture.ts`'s own classifiers) — this reclassification-after-the-
    // fact used to leave a `new`/`update`/`confirm`/`conflict`/`ambiguous`
    // candidate's already-set `draftSubjectId` in place, violating it.
    const finishedCandidates = candidates.map((c) => (rejectedSeqs.has(c.seq) ? { ...c, class: 'invalid' as const, draftDeltaIds: [], draftSubjectId: null } : { ...c, draftDeltaIds: draftDeltaIdsBySeq.get(c.seq) ?? [] }));
    const deltaRows = envelopeToDeltaRows(keptEnvelope, { orgId: job.orgId, modelId: job.modelId, createdBy: job.createdBy });
    const candidateRows = finishedCandidates.map(captureCandidateWireToRow);

    const written = await deps.writeCaptureDraft({
      jobId,
      branchId,
      commitId,
      commitBody: summarizeStats(runResult.stats),
      deltas: deltaRows,
      candidates: candidateRows,
      stats: runResult.stats,
    });

    return { status: 'parsed', branchId: written.branchId, stats: runResult.stats };
  } catch (e) {
    // Anything thrown here — an LLM error class with its own `.code`
    // (§11), a `RunCaptureError`/`CaptureDraftEnvelopeError` (an internal
    // pipeline invariant broken), the pre-write engine fold rejecting a
    // C1-C6 violation, or a genuinely unexpected bug — is a job failure,
    // never an unhandled rejection the caller has to guess at (§11: "nothing
    // fails silently").
    const error = classifyError(e);
    await deps.setError(jobId, error);
    return { status: 'failed', error };
  }
}
