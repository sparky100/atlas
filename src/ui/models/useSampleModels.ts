import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { SampleModelSummary } from '../../contracts/sampleModel';
import { slugForCopy } from '../../db/copyModel';
import { copySampleModel, listSampleModels } from '../../db/sampleModels';
import type { ModelRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UseSampleModelsResult {
  samples: SampleModelSummary[];
  loading: boolean;
  /** The id of the sample being copied right now, or null. */
  copyingId: UUID | null;
  /** Plain-English failure from the last attempt, or null. */
  error: string | null;
  /** Copies `sample` into the organisation as a new model; resolves to the new model, or null if it failed. */
  copy: (sample: SampleModelSummary, existingSlugs: readonly string[]) => Promise<ModelRow | null>;
}

/** "Start with a sample model" (ADR-033): the published samples, and one call to copy one into `orgId`. Only fetches when `enabled`. */
export function useSampleModels(orgId: UUID | null, authorId: UUID | null, enabled: boolean): UseSampleModelsResult {
  const queryClient = useQueryClient();
  const [copyingId, setCopyingId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.sampleModels(),
    queryFn: async () => {
      try {
        return await listSampleModels(supabase);
      } catch (e) {
        reportError("Couldn't load the sample models.", e);
        throw e;
      }
    },
    enabled,
  });

  const copy = useCallback(
    async (sample: SampleModelSummary, existingSlugs: readonly string[]) => {
      if (!orgId || !authorId) return null;
      setError(null);
      setCopyingId(sample.id);
      try {
        const result = await copySampleModel(supabase, { sample, orgId, name: sample.name, slug: slugForCopy(sample.name, existingSlugs), authorId });
        if (!result.ok) {
          setError(result.message);
          return null;
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.modelsForOrg(orgId) });
        return result.model;
      } catch (e) {
        setError('Could not add this sample model.');
        reportError('Could not add this sample model.', e);
        return null;
      } finally {
        setCopyingId(null);
      }
    },
    [authorId, orgId, queryClient],
  );

  return { samples: data ?? [], loading: enabled && isLoading, copyingId, error, copy };
}
