/**
 * Organisation and membership repository operations. Thin, typed wrappers —
 * no business logic beyond what a single-row insert/select needs, matching
 * branches.ts/tags.ts's own module comment about the untyped client's
 * `eslint-disable` boundary.
 *
 * `listOrganisationsForUser` relies entirely on RLS (`organisations_select`
 * uses `atlas.is_member(id)`) rather than joining `members` from the
 * client: a plain `select * from organisations` as the caller's own
 * session already returns exactly the organisations they belong to.
 */
import type { Client } from './client';
import type { MemberRow, OrganisationRow } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateOrganisationInput {
  /** Minted by the caller (S-1) — never generated here. Use `crypto.randomUUID()` at the call site. */
  id: UUID;
  name: string;
  slug: string;
  createdBy: UUID;
}

export async function createOrganisation(supabase: Client, input: CreateOrganisationInput): Promise<OrganisationRow> {
  const row = { id: input.id, name: input.name, slug: input.slug, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('organisations').insert(row).select('*').single();
  if (error) throw new Error(`createOrganisation: ${error.message}`);
  return data as OrganisationRow;
}

export async function listOrganisationsForUser(supabase: Client): Promise<OrganisationRow[]> {
  const { data, error } = await supabase.from('organisations').select('*').order('name');
  if (error) throw new Error(`listOrganisationsForUser: ${error.message}`);
  return data as OrganisationRow[];
}

export async function getOrganisationBySlug(supabase: Client, slug: string): Promise<OrganisationRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('organisations').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`getOrganisationBySlug: ${error.message}`);
  return data as OrganisationRow | null;
}

/** The caller's own membership row in `orgId` — their role, for UI role-gating (RLS is the real enforcement; this is what the UI reads to decide what to show). */
export async function getMyMembership(supabase: Client, orgId: UUID, userId: UUID): Promise<MemberRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('members').select('*').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`getMyMembership: ${error.message}`);
  return data as MemberRow | null;
}
