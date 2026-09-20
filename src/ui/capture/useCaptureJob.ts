import { useCallback, useEffect, useRef, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { CaptureInputKind, CaptureJob } from '../../contracts/capture';
import { computeInputSha256Hex, captureInputObjectPath, insertCaptureJob, invokeCaptureRun, listCaptureJobs, uploadCaptureInput } from '../../db/captureJobs';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type CaptureJobsStatus = 'loading' | 'idle' | 'creating';

export interface CreateCaptureJobInput {
  inputKind: CaptureInputKind;
  inputName: string;
  /** Raw bytes to upload — the file's own content, or pasted text UTF-8-encoded. */
  bytes: Uint8Array;
  documentDate: string | null;
  reimportOfJobId: UUID | null;
}

export interface UseCaptureJobsResult {
  status: CaptureJobsStatus;
  jobs: CaptureJob[];
  error: string | null;
  createJob: (input: CreateCaptureJobInput) => Promise<CaptureJob | null>;
  /** Re-invokes `capture-run` for an already-created job (§3.2: "a failed job stays `pending` with `error` non-null and can be retried"). Fire-and-forget, like `createJob`'s own run — see that function's comment. */
  retryJob: (jobId: UUID) => void;
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
export function useCaptureJobs(modelId: UUID, orgId: UUID, userId: UUID | null): UseCaptureJobsResult {
  const [status, setStatus] = useState<CaptureJobsStatus>('loading');
  const [jobs, setJobs] = useState<CaptureJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const jobsRef = useRef<CaptureJob[]>(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    let cancelled = false;
    // `reload()` is only ever called once `status` is already back to
    // `'idle'` (`createJob` below sets it before its own first `reload()`),
    // so there's no in-flight `'creating'` for this reset to clobber —
    // same plain literal `useChanges.ts`'s own load effect uses.
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
  }, [modelId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (jobsRef.current.some((j) => j.status === 'pending' && j.error === null)) reload();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [reload]);

  const createJob = useCallback(
    async (input: CreateCaptureJobInput): Promise<CaptureJob | null> => {
      if (!userId) {
        setError('You must be signed in to start a capture run.');
        return null;
      }
      setError(null);
      setStatus('creating');
      const jobId: UUID = crypto.randomUUID();
      try {
        const inputSha256Hex = computeInputSha256Hex(input.bytes);
        await uploadCaptureInput(supabase, { orgId, modelId, jobId, filename: input.inputName, bytes: input.bytes });
        const job = await insertCaptureJob(supabase, {
          id: jobId,
          orgId,
          modelId,
          inputKind: input.inputKind,
          inputName: input.inputName,
          inputRef: `capture-inputs/${captureInputObjectPath(orgId, modelId, jobId, input.inputName)}`,
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
        }
        reload();
      });
    },
    [reload],
  );

  return { status, jobs, error, createJob, retryJob, reload };
}
