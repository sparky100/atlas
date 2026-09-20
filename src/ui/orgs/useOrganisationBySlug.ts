import { useQuery } from '@tanstack/react-query';
import { getOrganisationBySlug } from '../../db/organisations';
import type { OrganisationRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UseOrganisationBySlugResult {
  organisation: OrganisationRow | null;
  loading: boolean;
  error: string | null;
}

/**
 * E8 item (1): backed by the shared `QueryClient` (`src/ui/query/`) now,
 * not a per-component fetch — every page reading the same `slug` shares
 * one cache entry and one in-flight request, instead of each of the ~20
 * model-scoped routes independently re-querying `organisations` on mount.
 * Same external shape as before this migration (`organisation`/`loading`/
 * `error`), so every existing call site needed no change at all.
 */
export function useOrganisationBySlug(slug: string): UseOrganisationBySlugResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.organisationBySlug(slug),
    queryFn: async () => {
      try {
        return await getOrganisationBySlug(supabase, slug);
      } catch (e) {
        reportError("Couldn't load this organisation.", e);
        throw e;
      }
    },
    enabled: slug !== '',
  });

  return { organisation: data ?? null, loading: isLoading, error: error ? error.message : null };
}
