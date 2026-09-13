import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listOrgMemberProfiles } from '../../db/profiles';
import type { ProfileRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** Every fellow org member's profile, loaded once per org — the composer's own @mention autocomplete data source (`docs/HANDOFF-M1b-comments.md`: "lists org members by handle"). Not the member directory (SPEC §11, deferred to U4) — just enough to filter locally as someone types. */
export function useOrgMemberProfiles(orgId: UUID | null): ProfileRow[] {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  useEffect(() => {
    if (!orgId) {
      setProfiles([]);
      return;
    }
    let cancelled = false;
    listOrgMemberProfiles(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setProfiles(rows);
      })
      .catch((e: unknown) => {
        // Best-effort: the composer still works with no autocomplete
        // suggestions, same as any other progressive-enhancement lookup
        // in this codebase (e.g. FactBadge's own lazy fetches) — still
        // reported (S1 audit follow-up), so a real fetch failure leaves a
        // trace even though the UI degrades gracefully.
        reportError("Couldn't load org members for @mention autocomplete.", e);
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return profiles;
}
