/**
 * Platform-admin-only overview of every organisation and person
 * (`atlas.platform_admin_organisations` / `atlas.platform_admin_people`).
 * Both are `security definer` and refuse anyone who is not a platform admin;
 * this layer only maps rows to the contract shapes.
 */
import type { Client } from './client';
import type { PlatformAdminMembership, PlatformAdminOrganisation, PlatformAdminPerson } from '../contracts/platformAdmin';

interface OrganisationRow {
  org_id: string;
  name: string;
  created_at: string;
  member_count: number | string;
  element_count: number | string;
  changes_30d: number | string;
  active_people_30d: number | string;
  last_change_at: string | null;
  last_sign_in_at: string | null;
}

interface PersonRow {
  user_id: string;
  email: string | null;
  signed_up_at: string;
  last_sign_in_at: string | null;
  last_change_at: string | null;
  memberships: PlatformAdminMembership[] | null;
}

export type PlatformAdminResult<T> = { status: 'ok'; rows: T[] } | { status: 'error'; message: string };

export async function listPlatformAdminOrganisations(supabase: Client): Promise<PlatformAdminResult<PlatformAdminOrganisation>> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see llmProxyConfig.ts.
  const { data, error } = await supabase.schema('atlas').rpc('platform_admin_organisations');
  if (error) return { status: 'error', message: error.message };
  const rows = ((data ?? []) as OrganisationRow[]).map((r) => ({
    orgId: r.org_id,
    name: r.name,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    elementCount: Number(r.element_count),
    changes30d: Number(r.changes_30d),
    activePeople30d: Number(r.active_people_30d),
    lastChangeAt: r.last_change_at,
    lastSignInAt: r.last_sign_in_at,
  }));
  return { status: 'ok', rows };
}

export async function listPlatformAdminPeople(supabase: Client): Promise<PlatformAdminResult<PlatformAdminPerson>> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see llmProxyConfig.ts.
  const { data, error } = await supabase.schema('atlas').rpc('platform_admin_people');
  if (error) return { status: 'error', message: error.message };
  const rows = ((data ?? []) as PersonRow[]).map((r) => ({
    userId: r.user_id,
    email: r.email,
    signedUpAt: r.signed_up_at,
    lastSignInAt: r.last_sign_in_at,
    lastChangeAt: r.last_change_at,
    memberships: r.memberships ?? [],
  }));
  return { status: 'ok', rows };
}
