import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { copyModel, type CopyModelResult } from '../../db/copyModel';
import type { ModelRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export type CopyModelStatus = 'idle' | 'copying';

export interface UseCopyModelResult {
  status: CopyModelStatus;
  /** Plain-English failure from the last attempt, or null. */
  error: string | null;
  /** The last successful copy, for the "Open the copy" link. */
  copied: { model: ModelRow; elements: number; relationships: number } | null;
  copy: (name: string, slug: string) => Promise<CopyModelResult | null>;
}

/** Owner-only "Copy this model" (ADR-030): one call to `src/db/copyModel.ts`, then the org's model list is refreshed so the copy appears. */
export function useCopyModel(source: ModelRow, authorId: UUID | null): UseCopyModelResult {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CopyModelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<UseCopyModelResult['copied']>(null);

  const copy = useCallback(
    async (name: string, slug: string) => {
      if (!authorId) return null;
      setError(null);
      setCopied(null);
      setStatus('copying');
      try {
        const result = await copyModel(supabase, { source, name, slug, authorId });
        if (result.ok) {
          setCopied({ model: result.model, elements: result.copiedElements, relationships: result.copiedRelationships });
          await queryClient.invalidateQueries({ queryKey: queryKeys.modelsForOrg(source.org_id) });
        } else {
          setError(result.message);
        }
        return result;
      } catch (e) {
        setError('Could not copy this model.');
        reportError('Could not copy this model.', e);
        return null;
      } finally {
        setStatus('idle');
      }
    },
    [authorId, queryClient, source],
  );

  return { status, error, copied, copy };
}
