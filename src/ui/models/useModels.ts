import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createModel, listModelsForOrg } from '../../db/models';
import type { ModelRow } from '../../db/types';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UseModelsResult {
  models: ModelRow[];
  loading: boolean;
  error: string | null;
  createModel: (name: string, slug: string, createdBy: UUID) => Promise<ModelRow>;
}

/** E8 item (1): shared-cache version of this hook — see `useOrganisationBySlug.ts`'s own comment for the general shape. `createModel` still writes straight into the cached list via `setQueryData` (the same optimistic-append behaviour this hook already had) rather than a full refetch. */
export function useModels(orgId: UUID | null): UseModelsResult {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.modelsForOrg(orgId);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!orgId) return [];
      try {
        return await listModelsForOrg(supabase, orgId);
      } catch (e) {
        reportError("Couldn't load models.", e);
        throw e;
      }
    },
    enabled: orgId !== null,
  });

  const create = useCallback(
    async (name: string, slug: string, createdBy: UUID) => {
      if (!orgId) throw new Error('useModels: cannot create a model without an organisation');
      const model = await createModel(supabase, { id: crypto.randomUUID(), orgId, name, slug, createdBy });
      queryClient.setQueryData(queryKey, (prev: ModelRow[] | undefined) => [...(prev ?? []), model].sort((a, b) => a.name.localeCompare(b.name)));
      return model;
    },
    [orgId, queryClient, queryKey],
  );

  return { models: data ?? [], loading: isLoading, error: error ? error.message : null, createModel: create };
}
