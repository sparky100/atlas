import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { designerTrialStatus, type DesignerTrialStatus } from '../../db/llmProxyRequests';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * The Designer's free trial for this organisation (runs left, whether it has its own key). If it cannot be read,
 * `status` is null and the page says nothing about the trial rather than guessing; the Designer function still decides.
 *
 * It is never refetched while someone is working in the form (no refetch on focus), so a draft just received is not
 * replaced by "trial used up" under the person's hands. The panel takes one snapshot when it opens (`panel`) and counts
 * its own runs from there; the page re-reads when it is next opened.
 */
export function useDesignerTrial(orgId: UUID | null, mode: 'page' | 'panel' = 'page'): DesignerTrialStatus | null {
  const { data } = useQuery({
    queryKey: [...queryKeys.designerTrial(orgId), mode],
    enabled: orgId !== null && orgId !== '',
    staleTime: mode === 'panel' ? Infinity : 0,
    gcTime: mode === 'panel' ? 0 : 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => (orgId ? designerTrialStatus(supabase, orgId) : Promise.reject(new Error('No organisation.'))),
    retry: false,
  });
  return data ?? null;
}
