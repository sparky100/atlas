/**
 * F2 (full K1) PR14: `capture_jobs` repository — insert, list, single-row
 * read via `listCaptureJobs`, and the re-import candidate lookup
 * (SPEC-capture.md §9.3) — plus the two boundary conversions
 * `src/contracts/capture.ts`'s own module comment leaves open ("the actual
 * insert/select boundary a later PR adds"): `bytea`'s PostgREST wire form
 * (`\x`-prefixed hex) into/out of the plain hex string `CaptureJob.inputSha256`
 * carries, and the two calls a capture run itself depends on — uploading
 * the input to Storage, and invoking the `capture-run` edge function
 * (PR12).
 *
 * Untyped client, same as every other src/db repository (branches.ts's own
 * module comment) — `eslint-disable` comments mark exactly that boundary.
 */
import { bytesToHex } from '@noble/hashes/utils.js';
import type { CaptureRunStepResult } from '../capture/captureRunStep';
import type { UUID } from '../contracts/delta';
import type { CaptureInputKind, CaptureJob } from '../contracts/capture';
import { captureJobRowToWire } from '../contracts/capture';
import type { Client } from './client';
import type { CaptureJobRow } from './types';

const CAPTURE_INPUTS_BUCKET = 'capture-inputs';

/**
 * SHA-256 of the exact bytes about to be uploaded, hex-encoded —
 * `CaptureJob.inputSha256`'s own wire shape. Web Crypto (`crypto.subtle`),
 * not `@noble/hashes` — this runs on the full file's bytes in the browser's
 * main thread (`UploadCaptureDialog.tsx`, on file selection and again on
 * submit), and a pure-JS hash over a multi-megabyte PDF was slow enough to
 * visibly stall the dialog with no way to yield a paint mid-hash. Native
 * `crypto.subtle.digest` is async by construction (never blocks the render
 * that requests it) and available everywhere this function runs — browser,
 * Vitest (Node ≥19), and the `capture-run` edge function's Deno runtime —
 * so the standard SHA-256 digest this produces is identical to
 * `@noble/hashes`' own, just computed off the render path.
 */
export async function computeInputSha256Hex(bytes: Uint8Array): Promise<string> {
  // `Uint8Array`'s own generic buffer parameter (`ArrayBufferLike`, which
  // includes `SharedArrayBuffer`) is stricter than `BufferSource` requires
  // here — a TS lib mismatch, not a real runtime concern (every caller
  // constructs `bytes` from a plain `ArrayBuffer`, never a shared one).
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/** PostgREST's own wire form for a `bytea` column is `\x`-prefixed hex — stripped here so `captureJobRowToWire` always sees the plain hex string its own type comment promises. */
function byteaHexToPlainHex(bytea: string): string {
  return bytea.startsWith('\\x') ? bytea.slice(2) : bytea;
}

function rowToWire(row: CaptureJobRow): CaptureJob {
  return captureJobRowToWire({ ...row, input_sha256: byteaHexToPlainHex(row.input_sha256) });
}

/** §3.4: `{org_id}/{model_id}/{job_id}/{filename}` — the object path inside the `capture-inputs` bucket. `capture_jobs.input_ref` stores this with the bucket name prefixed on (`capture-inputs/...`); `supabase/functions/capture-run/db.ts`'s own `storageObjectPathFrom` strips that prefix back off — keep the two in sync if either changes. */
export function captureInputObjectPath(orgId: UUID, modelId: UUID, jobId: UUID, filename: string): string {
  return `${orgId}/${modelId}/${jobId}/${filename}`;
}

export interface UploadCaptureInputInput {
  orgId: UUID;
  modelId: UUID;
  jobId: UUID;
  filename: string;
  bytes: Uint8Array;
}

/**
 * Uploads before the `capture_jobs` row is inserted — `capture-run`'s own
 * `downloadInput` step needs the object in place from the very first
 * invocation, and the job row's `input_ref` has nothing to point at until
 * the object already has a path.
 */
export async function uploadCaptureInput(supabase: Client, input: UploadCaptureInputInput): Promise<void> {
  const path = captureInputObjectPath(input.orgId, input.modelId, input.jobId, input.filename);
  // `Uint8Array<ArrayBufferLike>` vs. `BlobPart`'s own `Uint8Array<ArrayBuffer>`: every caller here builds `bytes` from `File.arrayBuffer()` or `TextEncoder.encode()`, both real (never shared) `ArrayBuffer`s — the assertion matches what's actually there, not a widening of it.
  const { error } = await supabase.storage.from(CAPTURE_INPUTS_BUCKET).upload(path, new Blob([input.bytes as Uint8Array<ArrayBuffer>]), { contentType: 'application/octet-stream' });
  if (error) throw new Error(`uploadCaptureInput: ${error.message}`);
}

export interface InsertCaptureJobInput {
  /** Minted by the caller — same `crypto.randomUUID()` convention every other insert in this codebase uses; the same id also names the Storage object path uploaded just before this call. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  inputKind: CaptureInputKind;
  inputName: string;
  inputRef: string;
  inputSha256Hex: string;
  documentDate: string | null;
  reimportOfJobId: UUID | null;
  createdBy: UUID;
}

/** `capture_jobs_insert`'s RLS (contributor+, `created_by = auth.uid()`) is the real gate; `canRunCapture` (src/ui/orgs/roleGates.ts) only decides whether the UI offers this at all. */
export async function insertCaptureJob(supabase: Client, input: InsertCaptureJobInput): Promise<CaptureJob> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    input_kind: input.inputKind,
    input_name: input.inputName,
    input_ref: input.inputRef,
    input_sha256: '\\x' + input.inputSha256Hex,
    document_date: input.documentDate,
    status: 'pending' as const,
    reimport_of_job_id: input.reimportOfJobId,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('capture_jobs').insert(row).select('*').single();
  if (error) throw new Error(`insertCaptureJob: ${error.message}`);
  return rowToWire(data as CaptureJobRow);
}

/** Every capture job on this model, newest first — the job list page's own read (`capture_jobs_select`'s RLS: any member). */
export async function listCaptureJobs(supabase: Client, modelId: UUID): Promise<CaptureJob[]> {
  const { data, error } = await supabase.from('capture_jobs').select('*').eq('model_id', modelId).order('created_at', { ascending: false });
  if (error) throw new Error(`listCaptureJobs: ${error.message}`);
  return ((data as CaptureJobRow[] | null) ?? []).map(rowToWire);
}

/** One capture job by id — the review page's own header read (`capture_jobs_select`'s RLS: any member). `null` for an unknown or not-yet-visible id, never a thrown error, matching `getBranch`'s own convention. */
export async function getCaptureJob(supabase: Client, jobId: UUID): Promise<CaptureJob | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('capture_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw new Error(`getCaptureJob: ${error.message}`);
  return data ? rowToWire(data as CaptureJobRow) : null;
}

/**
 * §9.3: "the client offers the most recent `parsed`/`reviewed` job with the
 * same `input_name` as the default" — looked up once the upload dialog
 * knows the chosen file's (or paste's) own name. `status` is a fixed
 * two-value list here, never a caller-supplied id list — CLAUDE.md rule 8's
 * own named exception for `.in()`.
 */
export async function findReimportCandidate(supabase: Client, modelId: UUID, inputName: string): Promise<CaptureJob | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase
    .from('capture_jobs')
    .select('*')
    .eq('model_id', modelId)
    .eq('input_name', inputName)
    .in('status', ['parsed', 'reviewed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findReimportCandidate: ${error.message}`);
  return data ? rowToWire(data as CaptureJobRow) : null;
}

export type InvokeCaptureRunResult = CaptureRunStepResult | { status: 'error'; message: string };

/**
 * A non-2xx edge-function response. supabase-js throws a `FunctionsHttpError`
 * whose `.context` is the raw `Response`; `capture-run`'s own 422 body is
 * `{status:'failed', error:{code,message}}` and a request-level failure is
 * `{status:'error', message}`. Read that body so the real failure surfaces
 * instead of the generic "Edge Function returned a non-2xx status code".
 */
async function invokeErrorBody(error: unknown): Promise<InvokeCaptureRunResult | null> {
  const context = typeof error === 'object' && error !== null ? (error as { context?: unknown }).context : undefined;
  if (!context || typeof (context as { json?: unknown }).json !== 'function') return null;
  let body: unknown;
  try {
    body = await (context as { json: () => Promise<unknown> }).json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.status === 'failed') {
    const e = record.error;
    if (typeof e === 'object' && e !== null) {
      const { code, message } = e as Record<string, unknown>;
      if (typeof code === 'string' && typeof message === 'string') return { status: 'failed', error: { code, message } };
    }
  }
  if (record.status === 'error' && typeof record.message === 'string') {
    return { status: 'error', message: record.message };
  }
  return null;
}

/**
 * Invokes `capture-run` (the edge function, PR12) for one job. One
 * invocation runs the whole pipeline or fails outright
 * (`captureRunStep.ts`'s own K-12 narrowing note) — this call's own promise
 * stays pending for the entire run, so a caller that wants a live status
 * polls `capture_jobs` alongside it (`listCaptureJobs`/`reload`) rather than
 * waiting on this promise to resolve. Never leaks the raw Supabase `error`
 * object, same convention `sendInviteEmail` (src/db/invites.ts) already
 * uses for the one other edge-function call in this codebase.
 */
export async function invokeCaptureRun(supabase: Client, jobId: UUID): Promise<InvokeCaptureRunResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.functions.invoke('capture-run', { body: { jobId } });
  if (error) {
    const bodyError = await invokeErrorBody(error);
    if (bodyError) return bodyError;
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not reach the capture service.' };
  }
  return data as InvokeCaptureRunResult;
}

/**
 * §3.2: discards a `pending`/`parsed` job via `atlas.discard_capture_job` —
 * the "cancel" for a run that is taking too long or has got stuck (its
 * in-flight `capture-run` timed out, leaving it `pending` with no `error`),
 * and the "discard" for a failed one. The RPC marks the job `discarded` and
 * archives its draft branch; its own security-definer body re-checks
 * "creator (contributor+) or owner/architect" and the pending/parsed gate.
 */
export async function discardCaptureJob(supabase: Client, jobId: UUID): Promise<void> {
  const { error } = await supabase.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
  if (error) throw new Error(`discardCaptureJob: ${error.message}`);
}
