import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { dismissDuplicatePair, getLatestDuplicateCheckRun, listDuplicateCandidates, runDuplicateCheck } from '../../db/duplicates';
import type { DuplicateCandidateRow, DuplicateCheckRunRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type DuplicateCheckStatus = 'loading' | 'idle' | 'checking';

export interface UseDuplicateCheckResult {
  status: DuplicateCheckStatus;
  candidates: DuplicateCandidateRow[];
  /** Every element a returned candidate names, resolved once by `listDuplicateCandidates` itself — the same read that already excludes a merged-away/retracted element's own stale row (that function's own doc comment). */
  elementsById: Map<UUID, ElementsHeadRow>;
  latestRun: DuplicateCheckRunRow | null;
  error: string | null;
  /** Invokes `atlas.run_duplicate_check` and reloads the candidate list once it resolves. */
  checkNow: () => void;
  /** Invokes `atlas.dismiss_duplicate_pair` and reloads the candidate list. */
  dismiss: (elementAId: UUID, elementBId: UUID) => void;
  reload: () => void;
}

const POLL_INTERVAL_MS = 2500;

/**
 * F4 (ADR-019 "Amended (F4, ...)"): the duplicates report's own load/error/
 * reload plumbing — mirrors `useCaptureJobs`' shape exactly (`src/ui/capture/
 * useCaptureJob.ts`). `atlas.run_duplicate_check` is synchronous (by the time
 * it resolves the run has already reached `succeeded`/`failed`), but the
 * poll below still runs for as long as `latestRun.status === 'running'` —
 * the same "no realtime subscription for this table, plain interval
 * instead" convention `useCaptureJobs` already established, covering a
 * `pg_cron`-triggered run this hook didn't itself start.
 */
export function useDuplicateCheck(modelId: UUID, commitId: UUID): UseDuplicateCheckResult {
  const [status, setStatus] = useState<DuplicateCheckStatus>('loading');
  const [candidates, setCandidates] = useState<DuplicateCandidateRow[]>([]);
  const [elementsById, setElementsById] = useState<Map<UUID, ElementsHeadRow>>(new Map());
  const [latestRun, setLatestRun] = useState<DuplicateCheckRunRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const latestRunRef = useRef<DuplicateCheckRunRow | null>(latestRun);
  useEffect(() => {
    latestRunRef.current = latestRun;
  }, [latestRun]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([listDuplicateCandidates(supabase, modelId, commitId), getLatestDuplicateCheckRun(supabase, modelId)])
      .then(([{ candidates: candidateRows, elementsById: elementsMap }, run]) => {
        if (cancelled) return;
        setCandidates(candidateRows);
        setElementsById(elementsMap);
        setLatestRun(run);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load the duplicates report.');
          setStatus('idle');
          reportError("Couldn't load the duplicates report.", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, commitId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (latestRunRef.current?.status === 'running') reload();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [reload]);

  const checkNow = useCallback(() => {
    setError(null);
    setStatus('checking');
    void runDuplicateCheck(supabase, modelId)
      .then(() => {
        setStatus('idle');
        reload();
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Could not run the duplicate check.';
        setStatus('idle');
        setError(message);
        reportError("Couldn't run the duplicate check.", e);
      });
  }, [modelId, reload]);

  const dismiss = useCallback(
    (elementAId: UUID, elementBId: UUID) => {
      setError(null);
      void dismissDuplicatePair(supabase, modelId, elementAId, elementBId)
        .then(() => {
          reload();
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : 'Could not dismiss this pair.';
          setError(message);
          reportError("Couldn't dismiss this pair.", e);
        });
    },
    [modelId, reload],
  );

  return { status, candidates, elementsById, latestRun, error, checkNow, dismiss, reload };
}
