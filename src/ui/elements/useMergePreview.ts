import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { buildCommitLoader } from '../../db/commitLoader';
import { foldFromGenesis } from '../../engine/head';
import { buildMergeElementsDeltas, type MergeEffect } from '../../engine/mergeElements';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type MergePreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseMergePreviewResult {
  status: MergePreviewStatus;
  error: string | null;
  effect: MergeEffect | null;
}

/**
 * "Merge into…"'s own live preview (E7) — folds `modelId`'s commit graph up
 * to `expectedHeadCommitId` (the exact head the real merge will fold from;
 * never `searchCommitId`, which is only ever the target picker's own
 * search pool, always main's real head per `RetireAction.tsx`'s identical
 * convention) and calls `buildMergeElementsDeltas` as a throwaway dry run,
 * keeping only its `effect` — the exact classification the real commit
 * will use, never a second, independently-approximated one. `survivorId`
 * of `null` means no target has been picked yet, so there's nothing to
 * preview (`status` stays `'idle'`).
 */
export function useMergePreview(modelId: UUID, expectedHeadCommitId: UUID, survivorId: UUID | null, loserId: UUID): UseMergePreviewResult {
  const [status, setStatus] = useState<MergePreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [effect, setEffect] = useState<MergeEffect | null>(null);

  useEffect(() => {
    if (survivorId === null) {
      setStatus('idle');
      setError(null);
      setEffect(null);
      return undefined;
    }
    const resolvedSurvivorId = survivorId;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    async function load(): Promise<void> {
      const loader = await buildCommitLoader(supabase, modelId);
      const head = foldFromGenesis(expectedHeadCommitId, loader);
      const { effect: computed } = buildMergeElementsDeltas(head, resolvedSurvivorId, loserId, crypto.randomUUID(), () => crypto.randomUUID());
      if (!cancelled) {
        setEffect(computed);
        setStatus('ready');
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't preview this merge.", e);
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Could not preview this merge.');
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, expectedHeadCommitId, survivorId, loserId]);

  return { status, error, effect };
}
