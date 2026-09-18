import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { buildCommitLoader } from '../../db/commitLoader';
import { foldFromGenesis } from '../../engine/head';
import { buildConvertSystemToModuleDeltas, type ConvertedRelationship } from '../../engine/convertSystemToModule';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ConvertToModulePreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ConvertToModulePreview {
  droppedAttributeKeys: string[];
  relationships: ConvertedRelationship[];
}

export interface UseConvertToModulePreviewResult {
  status: ConvertToModulePreviewStatus;
  error: string | null;
  preview: ConvertToModulePreview | null;
}

/**
 * "Convert to a module of…"'s own live preview — same shape
 * `useMergePreview.ts` establishes for "Merge into…": folds the real head
 * and calls `buildConvertSystemToModuleDeltas` as a throwaway dry run
 * (a random, never-committed `sourceId`), keeping only what the
 * confirmation copy needs — the exact computation the real commit will use,
 * never a second, hand-approximated one. `targetPlatformId` of `null` means
 * no target has been picked yet, so there's nothing to preview.
 */
export function useConvertToModulePreview(modelId: UUID, expectedHeadCommitId: UUID, systemId: UUID, targetPlatformId: UUID | null): UseConvertToModulePreviewResult {
  const [status, setStatus] = useState<ConvertToModulePreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ConvertToModulePreview | null>(null);

  useEffect(() => {
    if (targetPlatformId === null) {
      setStatus('idle');
      setError(null);
      setPreview(null);
      return undefined;
    }
    const resolvedTargetPlatformId = targetPlatformId;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    async function load(): Promise<void> {
      const loader = await buildCommitLoader(supabase, modelId);
      const head = foldFromGenesis(expectedHeadCommitId, loader);
      const { droppedAttributeKeys, relationships } = buildConvertSystemToModuleDeltas(head, systemId, resolvedTargetPlatformId, crypto.randomUUID(), () => crypto.randomUUID());
      if (!cancelled) {
        setPreview({ droppedAttributeKeys, relationships });
        setStatus('ready');
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't preview this conversion.", e);
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Could not preview this conversion.');
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, expectedHeadCommitId, systemId, targetPlatformId]);

  return { status, error, preview };
}
