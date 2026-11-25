import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecisionOptionMark } from '../../contracts/decisionOptionMark';
import type { UUID } from '../../contracts/delta';
import { listOptionMarksForDecision } from '../../db/decisionOptionMarks';
import type { DecisionOptionRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { addSuggestedOption } from './addSuggestedOption';
import { clockNow, loadPending, pendingKey, removePending, savePending } from './pendingOptions';

export interface PendingOptionsState {
  /** Suggested options still to be saved. */
  waiting: number;
  total: number;
  status: 'idle' | 'adding' | 'failed';
  error: string | null;
  /** Provenance for options an agent suggested, by option (branch) id. */
  marks: Map<UUID, DecisionOptionMark>;
  retry: () => void;
  /** Gives up on the options still waiting. They are not saved. */
  discard: () => void;
}

/**
 * Saves the options a person kept from the Designer's suggestions as the
 * decision page opens (journey proposal, step 2). Each one is saved on its own
 * and removed from the held list only once saved, so a failure leaves the rest
 * waiting with a retry, a refresh resumes where it stopped, and nothing is
 * added twice (`addSuggestedOption` is idempotent). Also loads the provenance
 * marks the page shows.
 */
export function usePendingOptions(args: {
  orgId: UUID;
  decisionId: UUID;
  userId: UUID | null;
  /** The page has loaded and this person may add options. */
  canAdd: boolean;
  /** Each saved suggestion is a candidate with no change yet. */
  applyCreatedOption: (option: DecisionOptionRow) => void;
}): PendingOptionsState {
  const { orgId, decisionId, userId, canAdd, applyCreatedOption } = args;
  const [status, setStatus] = useState<'idle' | 'adding' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [total, setTotal] = useState(0);
  const [marks, setMarks] = useState<Map<UUID, DecisionOptionMark>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const key = userId ? pendingKey(orgId, userId, decisionId) : null;

  const refreshMarks = useCallback(async () => {
    try {
      const list = await listOptionMarksForDecision(supabase, decisionId);
      setMarks(new Map(list.map((m) => [m.branchId, m])));
    } catch {
      // Provenance is a label on an option that already exists; failing to read it must not hide the options.
    }
  }, [decisionId]);

  useEffect(() => {
    void refreshMarks();
  }, [refreshMarks]);

  useEffect(() => {
    if (key === null || userId === null || !canAdd || running.current) return;
    const queue = loadPending(localStorage, key, clockNow());
    setWaiting(queue.length);
    if (queue.length === 0) return;
    running.current = true;
    setTotal((t) => Math.max(t, queue.length));
    setStatus('adding');
    setError(null);
    void (async () => {
      for (const option of queue) {
        try {
          const added = await addSuggestedOption({ decisionId, userId, option });
          applyCreatedOption(added);
          removePending(localStorage, key, option.id, clockNow());
          setWaiting((w) => Math.max(0, w - 1));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not save a suggested option.');
          setStatus('failed');
          running.current = false;
          await refreshMarks();
          return;
        }
      }
      setStatus('idle');
      running.current = false;
      await refreshMarks();
    })();
  }, [key, userId, canAdd, decisionId, applyCreatedOption, attempt, refreshMarks]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const discard = useCallback(() => {
    if (key !== null) savePending(localStorage, key, [], clockNow());
    setWaiting(0);
    setStatus('idle');
    setError(null);
  }, [key]);

  return { waiting, total, status, error, marks, retry, discard };
}
