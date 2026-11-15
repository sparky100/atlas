import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { publishSampleModel, type PublishSampleResult } from '../../db/sampleModels';
import type { ModelRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UsePublishSampleModelResult {
  status: 'idle' | 'publishing';
  /** Plain-English failure from the last attempt, or null. */
  error: string | null;
  /** The last successful publish, for the confirmation line. */
  published: { version: number; elements: number; relationships: number } | null;
  publish: (slug: string) => Promise<PublishSampleResult | null>;
}

/** Platform admin only (ADR-033): one call to `src/db/sampleModels.ts`; `sample_models_insert`'s row-level security is the real gate. */
export function usePublishSampleModel(model: ModelRow, userId: UUID | null): UsePublishSampleModelResult {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'publishing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<UsePublishSampleModelResult['published']>(null);

  const publish = useCallback(
    async (slug: string) => {
      if (!userId) return null;
      setError(null);
      setPublished(null);
      setStatus('publishing');
      try {
        const result = await publishSampleModel(supabase, { source: model, slug }, userId);
        if (result.ok) {
          setPublished({ version: result.version, elements: result.elements, relationships: result.relationships });
          await queryClient.invalidateQueries({ queryKey: queryKeys.sampleModels() });
        } else {
          setError(result.message);
        }
        return result;
      } catch (e) {
        setError('Could not publish this sample.');
        reportError('Could not publish this sample.', e);
        return null;
      } finally {
        setStatus('idle');
      }
    },
    [model, queryClient, userId],
  );

  return { status, error, published, publish };
}
