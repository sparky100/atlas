import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { backfillCapabilityOrder } from '../../db/backfillCapabilityOrder';
import { supabase } from '../supabaseClient';

export type BackfillCapabilityOrderStatus = 'idle' | 'backfilling';

export interface UseBackfillCapabilityOrderInput {
  modelId: UUID;
  userId: UUID | null;
  /** Reloads the page's own capability tree — required after a real `backfilled` run: the backfill commit moves main's head, so `CapabilityMapPage.tsx`'s own `state.data.commitId` (every other commit on this page, including a reorder swap, is built against it) would otherwise go stale and the next commit would be rejected as a conflict. */
  onBackfilled: () => void;
}

export interface UseBackfillCapabilityOrderResult {
  status: BackfillCapabilityOrderStatus;
  /** Result of the last run, once it's finished — success or "nothing to backfill" alike. Cleared on the next run. */
  message: string | null;
  error: string | null;
  backfill: () => Promise<void>;
}

/**
 * S1 item 13's "'Backfill capability order' owner action in the overflow
 * menu": a thin UI wrapper around `src/db/backfillCapabilityOrder.ts`'s
 * already-tested batch function — this hook adds nothing of its own beyond
 * the idle/backfilling/message shape every other maintenance action here
 * (`useExportCapabilityMap.ts`) already uses. Idempotent by construction:
 * `backfillCapabilityOrder` only ever writes deltas for capabilities that
 * currently lack an `order`, so running it again once every capability
 * already has one is a harmless no-op (`kind: 'nothing-to-backfill'`) —
 * safe to click more than once, and safe to leave in the menu indefinitely
 * rather than needing to time its own removal precisely.
 */
export function useBackfillCapabilityOrder(input: UseBackfillCapabilityOrderInput): UseBackfillCapabilityOrderResult {
  const { modelId, userId, onBackfilled } = input;
  const [status, setStatus] = useState<BackfillCapabilityOrderStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backfill = useCallback(async () => {
    if (!userId) {
      setError('You must be signed in to backfill capability order.');
      return;
    }
    setError(null);
    setMessage(null);
    setStatus('backfilling');

    try {
      const result = await backfillCapabilityOrder(supabase, { modelId, userId });
      setStatus('idle');
      if (!result.ok) {
        setError(`Could not backfill: ${result.message}`);
        return;
      }
      setMessage(result.kind === 'backfilled' ? `Backfilled order for ${String(result.backfilled)} capabilit${result.backfilled === 1 ? 'y' : 'ies'}.` : result.message);
      if (result.kind === 'backfilled') onBackfilled();
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not backfill capability order.');
    }
  }, [modelId, userId, onBackfilled]);

  return { status, message, error, backfill };
}
