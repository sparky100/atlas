import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listMemberEvents } from '../../db/memberEvents';
import { listProfilesByIds } from '../../db/profiles';
import type { MemberEventRow, ProfileRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseMemberEventsResult {
  events: MemberEventRow[];
  profilesById: Map<UUID, ProfileRow>;
  loading: boolean;
  error: string | null;
}

/**
 * F7 item 5: `OrganisationSettingsView`'s "Membership audit" panel — the
 * event list plus one batch profile lookup for every actor/target id it
 * names, the same "one list query, one batch profile query" shape
 * `listMembers` already uses for the member directory sitting right next to
 * this on the same page. The distinct-user count here is bounded by
 * everyone who has ever been a member, invited, or acted on this org —
 * exactly the same "stays small" assumption `listMembers` already makes for
 * an org's *current* membership (ADR-009 Preface #7's "one or two
 * architects" target market).
 */
export function useMemberEvents(orgId: UUID | null): UseMemberEventsResult {
  const [events, setEvents] = useState<MemberEventRow[]>([]);
  const [profilesById, setProfilesById] = useState<Map<UUID, ProfileRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setEvents([]);
      setProfilesById(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listMemberEvents(supabase, orgId)
      .then(async (rows) => {
        if (!cancelled) setEvents(rows);
        const userIds = [...new Set(rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter((id): id is UUID => id !== null))];
        const profiles = userIds.length > 0 ? await listProfilesByIds(supabase, userIds) : [];
        if (!cancelled) setProfilesById(new Map(profiles.map((p) => [p.user_id, p])));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the membership audit');
        reportError('Could not load the membership audit.', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { events, profilesById, loading, error };
}
