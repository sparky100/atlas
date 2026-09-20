import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { listOrgMemberProfiles } from '../../db/profiles';
import type { ProfileRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * Every fellow org member's profile, loaded once per org — the composer's
 * own @mention autocomplete data source (`docs/HANDOFF-M1b-comments.md`:
 * "lists org members by handle"). Not the member directory (SPEC §11,
 * deferred to U4) — just enough to filter locally as someone types.
 *
 * E8 item (1): shared-cache version — see `useOrganisationBySlug.ts`'s own
 * comment for the general shape; "loaded once per org" is now literal —
 * every comment composer open in the same org shares one cached fetch.
 */
export function useOrgMemberProfiles(orgId: UUID | null): ProfileRow[] {
  const { data } = useQuery({
    queryKey: queryKeys.orgMemberProfiles(orgId),
    queryFn: async () => {
      if (!orgId) return [];
      try {
        return await listOrgMemberProfiles(supabase, orgId);
      } catch (e) {
        // Best-effort: the composer still works with no autocomplete
        // suggestions, same as any other progressive-enhancement lookup
        // in this codebase (e.g. FactBadge's own lazy fetches) — still
        // reported (S1 audit follow-up), so a real fetch failure leaves a
        // trace even though the UI degrades gracefully.
        reportError("Couldn't load org members for @mention autocomplete.", e);
        return [];
      }
    },
    enabled: orgId !== null,
  });

  return data ?? [];
}
