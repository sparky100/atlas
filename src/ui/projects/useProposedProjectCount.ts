import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { countProposedProjects } from '../../db/projects';
import { reportError } from '../errors/errorBannerStore';
import { useAfterPageData } from '../perf/useAfterPageData';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * How many projects on this model are proposed and waiting to be accepted — the Projects nav item's badge. `null` until
 * known, so the badge shows nothing rather than a guessed zero. Re-read on every navigation, like the Decisions badge.
 */
export function useProposedProjectCount(modelId: UUID | null): number | null {
  const { pathname } = useLocation();
  const afterPageData = useAfterPageData();
  const { data, refetch } = useQuery({
    queryKey: queryKeys.proposedProjectCount(modelId),
    queryFn: async () => {
      if (!modelId) return 0;
      try {
        return await countProposedProjects(supabase, modelId);
      } catch (e) {
        reportError("Couldn't load the proposed projects count.", e);
        throw e;
      }
    },
    enabled: modelId !== null && afterPageData,
    staleTime: 0,
  });
  useEffect(() => {
    if (modelId !== null && afterPageData) void refetch();
  }, [pathname, modelId, refetch, afterPageData]);
  return data ?? null;
}
