import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { CHANGE_BRIEF_FILENAME, type CaptureInputKind, type CaptureJob } from '../../contracts/capture';
import { computeInputSha256Hex, captureInputObjectPath, discardCaptureJob, insertCaptureJob, invokeCaptureRun, listCaptureJobs, uploadCaptureInput } from '../../db/captureJobs';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * `'uploading'`/`'saving'` replace the single, unchanging `'creating'` this
 * used to be — the reported gap: for a large file, `createJob` spends real,
 * visible time uploading the raw bytes to Storage before it ever inserts
 * the job row, and a single static "Starting…" button label the whole time
 * gave no sign anything was actually progressing. Two named phases let
 * `UploadCaptureDialog.tsx` show which one is running.
 */
export type CaptureJobsStatus = 'loading' | 'idle' | 'uploading' | 'saving';

/** Whichever of `'uploading'`/`'saving'` — a submission is in flight, same as the old single `status === 'creating'` check every disabled-while-submitting control already used. */
export function isCreatingJob(status: CaptureJobsStatus): boolean {
  return status === 'uploading' || status === 'saving';
}

export interface CreateCaptureJobInput {
  inputKind: CaptureInputKind;
  inputName: string;
  /** Raw bytes to upload — the file's own content, or pasted text UTF-8-encoded. */
  bytes: Uint8Array;
  documentDate: string | null;
  reimportOfJobId: UUID | null;
  /** `UploadCaptureDialog.tsx` already hashes `bytes` itself (to compare against a re-import candidate) — passing that result through here avoids hashing the same multi-megabyte file a second time on submit. `undefined` (a caller with no reason to have hashed already, or hashing not yet finished) computes it here instead. */
  inputSha256Hex?: string | undefined;
}

export interface UseCaptureJobsResult {
  status: CaptureJobsStatus;
  jobs: CaptureJob[];
  error: string | null;
  createJob: (input: CreateCaptureJobInput) => Promise<CaptureJob | null>;
  /** Re-invokes `capture-run` for an already-created job (§3.2: "a failed job stays `pending` with `error` non-null and can be retried"). Fire-and-forget, like `createJob`'s own run — see that function's comment. */
  retryJob: (jobId: UUID) => void;
  /** Discards `pending`/`parsed` jobs (`atlas.discard_capture_job`) — the "cancel" for a run that is taking too long or has got stuck, "discard" for a failed one, or a parsed draft nobody means to review; several at once for the review queue's "Discard older copies". One after another, reloading once — resolves to how many were actually discarded; the first failure stops the batch and is reported. */
  discardJobs: (jobIds: readonly UUID[]) => Promise<number>;
  reload: () => void;
}

const POLL_INTERVAL_MS = 2500;

/**
 * F2 PR14: the capture job list plus the "start a capture run" action —
 * mirrors `src/ui/changes/useChanges.ts`'s shape (load/error/reload
 * plumbing around one real create call). Named `useCaptureJob` (singular)
 * to match the plan's own file list, but the hook itself is model-scoped
 * and list-shaped, the same "create + list, together" split `useChanges`
 * already uses — there's no useful singular-job version of this hook that
 * `UploadCaptureDialog.tsx` and `CaptureJobListView.tsx` wouldn't both need
 * to duplicate.
 *
 * Polling: `capture_jobs` has no confirmed realtime publication and this
 * codebase has no existing polling hook to match, so this is a plain
 * interval that re-lists the model's jobs every `POLL_INTERVAL_MS` for as
 * long as any of them is still actually running (`pending`, no `error`
 * yet). `jobsRef` lets that check always read the latest list without the
 * interval itself being torn down and rebuilt on every reload.
 */
export function useCaptureJobs(modelId: UUID, orgId: UUID, userId: UUID | null, trackJobs = true): UseCaptureJobsResult {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CaptureJobsStatus>('loading');
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const jobsRef = useRef<CaptureJob[]>(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    if (!trackJobs) return;
    let cancelled = false;
    // `reload()` is only ever called once `status` is already back to
    // `'idle'` (`createJob` below sets it before its own first `reload()`),
    // so there's no in-flight `'uploading'`/`'saving'` for this reset to
    // clobber — same plain literal `useChanges.ts`'s own load effect uses.
    setStatus('loading');
    listCaptureJobs(supabase, modelId)
      .then((rows) => {
        if (cancelled) return;
        setJobs(rows);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load capture jobs.');
          setStatus('idle');
          reportError("Couldn't load capture jobs.", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken, trackJobs]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!trackJobs) return;
    const interval = setInterval(() => {
      if (jobsRef.current.some((j) => j.status === 'pending' && j.error === null)) reload();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [reload, trackJobs]);

  const createJob = useCallback(
    async (input: CreateCaptureJobInput): Promise<CaptureJob | null> => {
      if (!userId) {
        setError('You must be signed in to start a capture run.');
        return null;
      }
      setError(null);
      setStatus('uploading');
      const jobId: UUID = crypto.randomUUID();
      try {
        const inputSha256Hex = input.inputSha256Hex ?? (await computeInputSha256Hex(input.bytes));
        const filename = input.inputKind === 'change_brief' ? CHANGE_BRIEF_FILENAME : input.inputName;
        await uploadCaptureInput(supabase, { orgId, modelId, jobId, filename, bytes: input.bytes });
        setStatus('saving');
        const job = await insertCaptureJob(supabase, {
          id: jobId,
          orgId,
          modelId,
          inputKind: input.inputKind,
          inputName: input.inputName,
          inputRef: `capture-inputs/${captureInputObjectPath(orgId, modelId, jobId, filename)}`,
          inputSha256Hex,
          documentDate: input.documentDate,
          reimportOfJobId: input.reimportOfJobId,
          createdBy: userId,
        });
        setStatus('idle');
        reload();
        // Fire-and-forget: one `capture-run` invocation runs the whole
        // pipeline (K-12's own job-level-retry-only narrowing,
        // captureRunStep.ts) — a real LLM-backed run can legitimately take
        // tens of seconds. The dialog this feeds closes the moment the job
        // row exists; the poll above (not this promise) is what shows it
        // moving, and is also what notices it finishing.
        void invokeCaptureRun(supabase, jobId).then((runResult) => {
          if (runResult.status === 'error') {
            setError(`The capture run didn't start: ${runResult.message}. Use Retry once you're ready to try again.`);
            reportError("Couldn't start the capture run.", new Error(runResult.message));
          } else if (runResult.status === 'failed') {
            setError(`The capture run failed: ${runResult.error.message}. Use Retry once you're ready to try again.`);
            reportError("The capture run failed.", new Error(`${runResult.error.code}: ${runResult.error.message}`));
          }
          reload();
        });
        return job;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not start this capture run.';
        setStatus('idle');
        setError(message);
        reportError("Couldn't start this capture run.", e);
        return null;
      }
    },
    [modelId, orgId, userId, reload],
  );

  const retryJob = useCallback(
    (jobId: UUID) => {
      setError(null);
      void invokeCaptureRun(supabase, jobId).then((result) => {
        if (result.status === 'error') {
          setError(`Retry didn't start: ${result.message}.`);
          reportError("Couldn't retry this capture run.", new Error(result.message));
        } else if (result.status === 'failed') {
          setError(`Retry failed: ${result.error.message}.`);
          reportError("Retry of this capture run failed.", new Error(`${result.error.code}: ${result.error.message}`));
        }
        reload();
      });
    },
    [reload],
  );

  const discardJobs = useCallback(
    async (jobIds: readonly UUID[]): Promise<number> => {
      setError(null);
      let discarded = 0;
      try {
        for (const jobId of jobIds) {
          await discardCaptureJob(supabase, jobId);
          discarded += 1;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not discard this capture run.';
        setError(message);
        reportError("Couldn't discard this capture run.", e);
      }
      // The Changes nav badge counts parsed drafts (`useReviewQueueCount.ts`) — re-check it rather than leave a stale number.
      if (discarded > 0) void queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueueCount(modelId) });
      reload();
      return discarded;
    },
    [reload, queryClient, modelId],
  );

  return { status, jobs, error, createJob, retryJob, discardJobs, reload };
}
