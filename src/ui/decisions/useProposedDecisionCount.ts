import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { countProposedDecisions } from '../../db/decisions';
import { reportError } from '../errors/errorBannerStore';
import { useAfterFirstPaint } from '../perf/useAfterFirstPaint';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * How many decisions on this model are still proposed — the Decisions nav
 * item's badge. `null` until known, so the badge shows nothing rather than a
 * guessed zero. Re-read on every navigation, the same way the Changes badge
 * (`useOpenChangeCount`) is; the decision page also invalidates it when a
 * decision is chosen or cancelled in place.
 */
export function useProposedDecisionCount(modelId: UUID | null): number | null {
  const { pathname } = useLocation();
  const afterFirstPaint = useAfterFirstPaint();
  const { data, refetch } = useQuery({
    queryKey: queryKeys.proposedDecisionCount(modelId),
    queryFn: async () => {
      if (!modelId) return 0;
      try {
        return await countProposedDecisions(supabase, modelId);
      } catch (e) {
        reportError("Couldn't load the decisions count.", e);
        throw e;
      }
    },
    enabled: modelId !== null && afterFirstPaint,
    staleTime: 0,
  });
  useEffect(() => {
    if (modelId !== null && afterFirstPaint) void refetch();
  }, [pathname, modelId, refetch, afterFirstPaint]);
  return data ?? null;
}
