import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { syncDescriptionsFromMap } from '../../db/syncDescriptionsFromMap';
import { supabase } from '../supabaseClient';

export type SyncDescriptionsStatus = 'idle' | 'syncing';

export interface UseSyncDescriptionsInput {
  modelId: UUID;
  userId: UUID | null;
  onSynced: () => void;
}

export interface UseSyncDescriptionsResult {
  status: SyncDescriptionsStatus;
  /** Result of the last run, once it's finished — "Synced N description(s)…" or "nothing to sync". Cleared on the next run. */
  message: string | null;
  error: string | null;
  sync: () => Promise<void>;
}

/**
 * Bug A2's owner action: "Sync descriptions from starter map"
 * (src/ui/capabilityMap/SyncDescriptionsAction.tsx). Safe to click more
 * than once — src/db/syncDescriptionsFromMap.ts's own check for "nothing
 * left to sync" means a second click after a successful sync (or on a
 * model that never needed it) writes no commit at all, just reports that.
 */
export function useSyncDescriptions(input: UseSyncDescriptionsInput): UseSyncDescriptionsResult {
  const { modelId, userId, onSynced } = input;
  const [status, setStatus] = useState<SyncDescriptionsStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (!userId) {
      setError('You must be signed in to sync descriptions.');
      return;
    }
    setError(null);
    setMessage(null);
    setStatus('syncing');

    try {
      const result = await syncDescriptionsFromMap(supabase, { modelId });
      setStatus('idle');
      if (!result.ok) {
        setError(`Could not sync descriptions: ${result.message}`);
        return;
      }
      if (result.kind === 'nothing-to-sync') {
        setMessage(result.message);
        return;
      }
      setMessage(`Synced ${String(result.synced)} description(s) from the starter map.`);
      onSynced();
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not sync descriptions.');
    }
  }, [modelId, userId, onSynced]);

  return { status, message, error, sync };
}
