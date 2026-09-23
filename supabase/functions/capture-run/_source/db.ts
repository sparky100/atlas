/**
 * F2 (full K1) PR12, SPEC-capture.md §3.5: `capture-run`'s own thin,
 * service-role reads/writes — everything `index.ts` needs to build a real
 * `CaptureRunDeps` (`src/capture/captureRunStep.ts`). Deliberately does not
 * import `src/db` (that module is built around the browser client and its
 * own RLS-scoped auth flow) — every query here is a plain `@supabase/supabase-js`
 * call against a service-role client, following the same two read rules
 * `src/db` itself follows (SPEC §6.7): page past `max_rows` rather than
 * silently truncating (`selectAllRows` below — the same algorithm
 * `src/db/selectAll.ts` uses, duplicated rather than imported so this file
 * has zero `src/db` dependency at all), and never a growing `.in()` (every
 * query here is scoped by a single `model_id`/`job_id` equality filter,
 * never a caller-supplied id list).
 *
 * Imports `src/contracts/*` and `src/engine/*` directly (K-15) — the row
 * shapes and the fold are the same TypeScript the unit tests exercise.
 *
 * **This is the hand-authored source, not what gets deployed** — see
 * `_source/index.ts`'s own module comment: `pnpm functions:bundle:capture-run`
 * bundles this file into the deployed `supabase/functions/capture-run/index.ts`,
 * because Deno's edge runtime does not honour the `sloppy-imports` unstable
 * flag this file's extension-less `src/` imports would otherwise need
 * (confirmed against a real `supabase functions deploy` failure, not just a
 * disclosed risk — `docs/EDGE-FUNCTIONS.md`'s section on this function).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import type { CaptureJobError, CaptureJobProgress, CaptureStatus } from '../../../../src/contracts/capture.ts';
import type { UUID } from '../../../../src/contracts/delta.ts';
import { fromDeltaRow, type CommitRow, type DeltaRow, type ElementsHeadRow } from '../../../../src/contracts/rows.ts';
import type { Head } from '../../../../src/engine/deltas.ts';
import { foldFromGenesis, type CommitLoader, type CommitNode } from '../../../../src/engine/head.ts';
import type { CaptureRunDeps, CaptureRunJob, WriteCaptureDraftInput, WriteCaptureDraftOutput } from '../../../../src/capture/captureRunStep.ts';
import { DirectLlmClient, ProxyLlmClient, type LlmClient } from '../../../../src/capture/llm/client.ts';
import { buildMatchIndex, type MatchAliasInput } from '../../../../src/capture/matchIndex.ts';
import type { PreviousCandidateForDiff } from '../../../../src/capture/reimportDiff.ts';
import type { RunCaptureSource } from '../../../../src/capture/runCapture.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deno runtime, no shared type-checking with src/ (see supabase/functions/llm-proxy/index.ts's own identical disables).
type SupabaseClient = ReturnType<typeof createClient<any>>;

// ---------------------------------------------------------------------------
// Paging (SPEC §6.7) — the same algorithm as src/db/selectAll.ts, kept as
// a standalone copy per this file's own module comment.
// ---------------------------------------------------------------------------

interface SelectAllResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}
interface SelectAllQuery<T> {
  range(from: number, to: number): PromiseLike<SelectAllResult<T>>;
}

async function selectAllRows<T>(query: SelectAllQuery<T>, pageSize = 1000): Promise<T[]> {
  const results: T[] = [];
  let expectedCount: number | null = null;
  for (let offset = 0; ; offset += pageSize) {
    // eslint-disable-next-line no-await-in-loop -- pages must be fetched in order to detect a short final page.
    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`selectAllRows: ${error.message}`);
    if (offset === 0) {
      if (count == null) throw new Error('selectAllRows: query did not request an exact count.');
      expectedCount = count;
    }
    const rows = data ?? [];
    results.push(...rows);
    if (rows.length < pageSize) break;
  }
  if (results.length !== expectedCount) {
    throw new Error(`selectAllRows: expected ${String(expectedCount)} rows, got ${String(results.length)}.`);
  }
  return results;
}

// ---------------------------------------------------------------------------
// capture_jobs
// ---------------------------------------------------------------------------

interface CaptureJobRow {
  id: UUID;
  org_id: UUID;
  model_id: UUID;
  input_kind: 'spreadsheet' | 'pdf' | 'text';
  input_name: string;
  input_ref: string;
  document_date: string | null;
  status: CaptureStatus;
  reimport_of_job_id: UUID | null;
  target_branch_id: UUID | null;
  created_by: UUID;
}

function jobFromRow(row: CaptureJobRow): CaptureRunJob {
  return {
    id: row.id,
    orgId: row.org_id,
    modelId: row.model_id,
    inputKind: row.input_kind,
    inputName: row.input_name,
    inputRef: row.input_ref,
    documentDate: row.document_date,
    status: row.status,
    reimportOfJobId: row.reimport_of_job_id,
    targetBranchId: row.target_branch_id,
    createdBy: row.created_by,
  };
}

export async function readJob(service: SupabaseClient, jobId: UUID): Promise<CaptureRunJob | null> {
  const { data, error } = await service.from('capture_jobs').select('id, org_id, model_id, input_kind, input_name, input_ref, document_date, status, reimport_of_job_id, target_branch_id, created_by').eq('id', jobId).maybeSingle();
  if (error) throw new Error(`readJob: ${error.message}`);
  return data ? jobFromRow(data as CaptureJobRow) : null;
}

export async function beginAttempt(service: SupabaseClient, jobId: UUID, progress: CaptureJobProgress): Promise<void> {
  const { error } = await service.from('capture_jobs').update({ progress, error: null }).eq('id', jobId);
  if (error) throw new Error(`beginAttempt: ${error.message}`);
}

export async function setProgress(service: SupabaseClient, jobId: UUID, progress: CaptureJobProgress): Promise<void> {
  const { error } = await service.from('capture_jobs').update({ progress }).eq('id', jobId);
  if (error) throw new Error(`setProgress: ${error.message}`);
}

export async function setError(service: SupabaseClient, jobId: UUID, jobError: CaptureJobError): Promise<void> {
  // capture_jobs.error is `text` (SPEC-capture.md §3.2's own comment on why: "so the job list can render it without a second decode path for a column that's usually null") — the §11-shaped {code,message,detail?} object, JSON-encoded, exactly `src/contracts/capture.ts`'s own `captureJobRowToWire`/`captureJobWireToRow` round trip.
  const { error } = await service.from('capture_jobs').update({ error: JSON.stringify(jobError) }).eq('id', jobId);
  if (error) throw new Error(`setError: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Matching (§7.1) — the whole model's own elements_head + aliases.
// ---------------------------------------------------------------------------

export async function buildMatchIndexForModel(service: SupabaseClient, modelId: UUID) {
  const [elementsHeadRows, aliasRows] = await Promise.all([
    selectAllRows<ElementsHeadRow>(service.from('elements_head').select('element_id, element_type, name, parent_id, attributes, exists_delta_id', { count: 'exact' }).eq('model_id', modelId).order('element_id')),
    selectAllRows<MatchAliasInput>(service.from('aliases').select('element_id, alias_value, alias_type', { count: 'exact' }).eq('model_id', modelId).order('id')),
  ]);
  return buildMatchIndex(elementsHeadRows, aliasRows);
}

// ---------------------------------------------------------------------------
// Main's head (§6.1-§6.2 of SPEC-data-model.md) — the same "fetch every
// commit/delta for the model, fold from genesis" shape
// src/db/commitLoader.ts's buildCommitLoader uses, duplicated here (not
// imported — src/db is off-limits per this file's own module comment) so
// this function stays a plain CommitLoader src/engine/head.ts already knows
// how to walk.
// ---------------------------------------------------------------------------

async function buildCommitLoaderForModel(service: SupabaseClient, modelId: UUID): Promise<CommitLoader> {
  const [commitRows, deltaRows] = await Promise.all([
    selectAllRows<CommitRow>(service.from('commits').select('*', { count: 'exact' }).eq('model_id', modelId).order('id')),
    selectAllRows<DeltaRow>(service.from('deltas').select('*', { count: 'exact' }).eq('model_id', modelId).order('commit_id', { ascending: true }).order('seq', { ascending: true })),
  ]);

  const deltasByCommit = new Map<UUID, DeltaRow[]>();
  for (const row of deltaRows) {
    const list = deltasByCommit.get(row.commit_id);
    if (list) list.push(row);
    else deltasByCommit.set(row.commit_id, [row]);
  }

  const nodes = new Map<UUID, CommitNode>();
  for (const row of commitRows) {
    const deltaRowsForCommit = deltasByCommit.get(row.id) ?? [];
    nodes.set(row.id, { ...row, deltas: deltaRowsForCommit.map((r) => fromDeltaRow({ ...r, confidence: Number(r.confidence) })) });
  }
  return (id) => nodes.get(id);
}

/**
 * K-8/§7.1's fifth bullet, issue #285: when `targetBranchId` is set, also
 * folds that branch's own head, from the same model-scoped commit loader
 * (`buildCommitLoaderForModel` already reads every commit/delta for the
 * model, not just main's ancestry, so a second `foldFromGenesis` call
 * costs no extra I/O). `targetHead` is `null` when the job has no target
 * branch yet, or that branch's own `head_commit_id` is unset (a brand-new
 * `draft` branch always has one — SPEC §5.2 — but this reads defensively
 * rather than assuming it).
 */
export async function foldMainHead(service: SupabaseClient, modelId: UUID, targetBranchId: UUID | null): Promise<{ mainHeadCommitId: UUID; head: Head; targetHead: Head | null }> {
  const { data: mainBranch, error } = await service.from('branches').select('head_commit_id').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
  if (error) throw new Error(`foldMainHead: ${error.message}`);
  const mainHeadCommitId = (mainBranch as { head_commit_id: UUID } | null)?.head_commit_id;
  // ADR-018: main always has a real head — its own genesis commit at
  // minimum. A null/missing row here means the model itself is
  // misconfigured, not a legitimate "empty landscape" case runCapture()
  // could sensibly proceed against (there would be nowhere to base a
  // capture_draft branch's own parent_commit_id on).
  if (!mainHeadCommitId) throw new Error(`foldMainHead: model ${modelId} has no main branch head_commit_id.`);

  const loader = await buildCommitLoaderForModel(service, modelId);
  const head = foldFromGenesis(mainHeadCommitId, loader);

  let targetHead: Head | null = null;
  if (targetBranchId) {
    const { data: targetBranch, error: targetError } = await service.from('branches').select('head_commit_id').eq('id', targetBranchId).maybeSingle();
    if (targetError) throw new Error(`foldMainHead: ${targetError.message}`);
    const targetHeadCommitId = (targetBranch as { head_commit_id: UUID | null } | null)?.head_commit_id;
    if (targetHeadCommitId) targetHead = foldFromGenesis(targetHeadCommitId, loader);
  }

  return { mainHeadCommitId, head, targetHead };
}

// ---------------------------------------------------------------------------
// Re-import diff (§9.2) — the previous job's own candidates.
// ---------------------------------------------------------------------------

interface PreviousCandidateRow {
  row_key: string;
  kind: 'element' | 'relationship';
  element_type: PreviousCandidateForDiff['elementType'];
  relationship_type: PreviousCandidateForDiff['relationshipType'];
  proposal: PreviousCandidateForDiff['proposal'];
  evidence: PreviousCandidateForDiff['evidence'];
  decision: PreviousCandidateForDiff['decision'];
}

export async function readReimportPrevious(service: SupabaseClient, previousJobId: UUID): Promise<PreviousCandidateForDiff[]> {
  const rows = await selectAllRows<PreviousCandidateRow>(service.from('capture_candidates').select('row_key, kind, element_type, relationship_type, proposal, evidence, decision', { count: 'exact' }).eq('job_id', previousJobId).order('seq'));
  return rows.map((row) => ({ rowKey: row.row_key, kind: row.kind, elementType: row.element_type, relationshipType: row.relationship_type, proposal: row.proposal, evidence: row.evidence, decision: row.decision }));
}

// ---------------------------------------------------------------------------
// §3.1: the run's own `sources` row.
// ---------------------------------------------------------------------------

const PASTED_TEXT_PREVIEW_CHARS = 60;

function sourceNameFor(job: CaptureRunJob, source: RunCaptureSource): string {
  if (source.format === 'text') {
    const preview = source.text.length > PASTED_TEXT_PREVIEW_CHARS ? `${source.text.slice(0, PASTED_TEXT_PREVIEW_CHARS)}…` : source.text;
    return `Pasted text — ${preview.replace(/\s+/g, ' ').trim()}`;
  }
  return job.inputName;
}

export async function getOrCreateJobSource(service: SupabaseClient, job: CaptureRunJob, source: RunCaptureSource, mintId: () => UUID): Promise<UUID> {
  const existing = await service.from('sources').select('id').eq('capture_job_id', job.id).maybeSingle();
  if (existing.error) throw new Error(`getOrCreateJobSource: ${existing.error.message}`);
  if (existing.data) return (existing.data as { id: UUID }).id;

  const row = {
    id: mintId(),
    org_id: job.orgId,
    model_id: job.modelId,
    kind: 'capture_job' as const,
    name: sourceNameFor(job, source),
    uri: `capture-inputs/${job.orgId}/${job.modelId}/${job.id}/${job.inputName}`,
    captured_at: job.documentDate,
    capture_job_id: job.id,
    created_by: job.createdBy,
  };
  const { data, error } = await service.from('sources').insert(row).select('id').single();
  if (error) throw new Error(`getOrCreateJobSource: ${error.message}`);
  return (data as { id: UUID }).id;
}

// ---------------------------------------------------------------------------
// §3.4: the uploaded/pasted input itself, from the `capture-inputs` bucket.
// `input_ref` is stored as `capture-inputs/{org}/{model}/{job}/{filename}`
// (`writeCaptureDraft.integration.test.ts`'s own fixture value) — the bucket
// name as a path *segment*, which storage.objects itself never stores (the
// bucket is a separate column); the leading `capture-inputs/` is stripped
// before calling `.storage.from('capture-inputs').download(...)`.
// ---------------------------------------------------------------------------

const CSV_LIKE_EXTENSION = /\.(csv|tsv)$/i;
const JSON_EXTENSION = /\.json$/i;

function storageObjectPathFrom(inputRef: string): string {
  return inputRef.replace(/^capture-inputs\//, '');
}

export async function downloadInput(service: SupabaseClient, job: CaptureRunJob): Promise<RunCaptureSource> {
  const path = storageObjectPathFrom(job.inputRef);
  const { data, error } = await service.storage.from('capture-inputs').download(path);
  if (error) throw new Error(`downloadInput: ${error.message}`);
  const blob = data as Blob;

  if (job.inputKind === 'text') return { format: 'text', text: await blob.text() };
  if (job.inputKind === 'pdf') return { format: 'pdf', bytes: await blob.arrayBuffer() };
  // 'spreadsheet'.
  if (JSON_EXTENSION.test(job.inputName)) return { format: 'json', text: await blob.text() };
  if (CSV_LIKE_EXTENSION.test(job.inputName)) return { format: 'csv', text: await blob.text() };
  return { format: 'xlsx', bytes: await blob.arrayBuffer() };
}

// ---------------------------------------------------------------------------
// §6/§3.5: the LLM client. Defaults to the deployed `llm-proxy` in this
// same project, forwarding the *caller's own session JWT* (not the
// service-role key) as the bearer token — the proxy re-derives membership
// from that forwarded session via `members_select`'s RLS, and a service-role
// key is not a user-session JWT (it would fail that check with PostgREST's
// "Expected 3 parts in JWT; got 1"). The real contributor+ check already
// happened one layer up, in index.ts, against that same caller JWT.
// `CAPTURE_RUN_LLM_DIRECT=true` is an escape hatch for an environment with
// no llm-proxy deployed yet (SPEC §3.5: DirectLlmClient "used when no proxy
// is configured").
// ---------------------------------------------------------------------------

export function buildLlmClient(supabaseUrl: string, callerToken: string, orgId: UUID): LlmClient {
  if (Deno.env.get('CAPTURE_RUN_LLM_DIRECT') === 'true') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('buildLlmClient: CAPTURE_RUN_LLM_DIRECT=true but ANTHROPIC_API_KEY is not set.');
    return new DirectLlmClient({ apiKey });
  }
  return new ProxyLlmClient({ proxyUrl: `${supabaseUrl}/functions/v1/llm-proxy`, authToken: callerToken, orgId });
}

// ---------------------------------------------------------------------------
// §8.1: the one atomic write.
// ---------------------------------------------------------------------------

export async function writeCaptureDraft(service: SupabaseClient, input: WriteCaptureDraftInput): Promise<WriteCaptureDraftOutput> {
  const { data, error } = await service.schema('atlas').rpc('write_capture_draft', {
    p_job_id: input.jobId,
    p_branch_id: input.branchId,
    p_commit_id: input.commitId,
    p_commit_body: input.commitBody,
    p_deltas: input.deltas,
    p_candidates: input.candidates,
    p_stats: input.stats,
  });
  if (error) throw new Error(`writeCaptureDraft: ${error.message}`);
  return { branchId: (data as { id: UUID }).id };
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

export interface RealCaptureRunDepsConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** The caller's own session JWT (the same one `index.ts` authorized with) — forwarded to `llm-proxy` so its membership check re-derives a real user, not a service-role token. */
  callerToken: string;
  orgId: UUID;
  mintId: () => UUID;
}

/** Builds a real `CaptureRunDeps` (`src/capture/captureRunStep.ts`) against Postgres/Storage/llm-proxy — the only thing `index.ts` needs from this module besides `readJob` (used once, up front, for the caller-scoped RLS authorization check per §3.5 step 1). */
export function buildRealCaptureRunDeps(config: RealCaptureRunDepsConfig): CaptureRunDeps {
  const service = createClient(config.supabaseUrl, config.serviceRoleKey) as SupabaseClient;
  const mintId = config.mintId;

  return {
    readJob: (jobId) => readJob(service, jobId),
    beginAttempt: (jobId, progress) => beginAttempt(service, jobId, progress),
    setProgress: (jobId, progress) => setProgress(service, jobId, progress),
    setError: (jobId, jobError) => setError(service, jobId, jobError),
    buildMatchIndex: (modelId) => buildMatchIndexForModel(service, modelId),
    foldMainHead: (modelId, targetBranchId) => foldMainHead(service, modelId, targetBranchId),
    readReimportPrevious: (previousJobId) => readReimportPrevious(service, previousJobId),
    getOrCreateJobSource: (job, source) => getOrCreateJobSource(service, job, source, mintId),
    downloadInput: (job) => downloadInput(service, job),
    llmClient: buildLlmClient(config.supabaseUrl, config.callerToken, config.orgId),
    mintId,
    writeCaptureDraft: (input) => writeCaptureDraft(service, input),
  };
}
