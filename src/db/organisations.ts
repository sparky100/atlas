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
import type { MemberRow, MemberRole, OrganisationRow, ProfileRow } from './types';
import type { UUID } from '../contracts/delta';
import { listProfilesByIds } from './profiles';

export interface CreateOrganisationInput {
  /** Minted by the caller (S-1) — never generated here. Use `crypto.randomUUID()` at the call site. */
  id: UUID;
  name: string;
  slug: string;
  createdBy: UUID;
  /** F3a: a "just me" personal organisation — skips the invite step and reads as personal in settings. Defaults to false. */
  isPersonal?: boolean;
}

export async function createOrganisation(supabase: Client, input: CreateOrganisationInput): Promise<OrganisationRow> {
  const row = { id: input.id, name: input.name, slug: input.slug, created_by: input.createdBy, is_personal: input.isPersonal ?? false };
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

/** The reverse lookup — id to slug, for anything that only has an id in hand and needs a real URL (Sprint M1b's notification tray deep link: a notification names a `model_id`, `getModelById` gets its `org_id`, and this gets that org's own slug — see `useNotificationTray.ts`'s own module comment). */
export async function getOrganisationById(supabase: Client, id: UUID): Promise<OrganisationRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('organisations').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getOrganisationById: ${error.message}`);
  return data as OrganisationRow | null;
}

/** The caller's own membership row in `orgId` — their role, for UI role-gating (RLS is the real enforcement; this is what the UI reads to decide what to show). */
export async function getMyMembership(supabase: Client, orgId: UUID, userId: UUID): Promise<MemberRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('members').select('*').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`getMyMembership: ${error.message}`);
  return data as MemberRow | null;
}

export interface UpdateOrganisationInput {
  name?: string;
  slug?: string;
  /** F3a: owner-editable review policy — the minimum number of architect members the required reviewer set must include. */
  reviewMinRequiredArchitects?: number;
  /** F15 (ADR-028 §7): owner-only switch for Ask Atlas. */
  aiAssistantEnabled?: boolean;
}

/** Sprint 7j item 2: rename/slug — gated by `organisations_update`'s RLS (owner) and the column-restricted grant `20260911050000_organisation_settings.sql` adds (name/slug only). F3a adds `review_min_required_architects` to that grant (20260914060000). */
export async function updateOrganisation(supabase: Client, id: UUID, input: UpdateOrganisationInput): Promise<OrganisationRow> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.reviewMinRequiredArchitects !== undefined) patch.review_min_required_architects = input.reviewMinRequiredArchitects;
  if (input.aiAssistantEnabled !== undefined) patch.ai_assistant_enabled = input.aiAssistantEnabled;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('organisations').update(patch).eq('id', id).select('*').single();
  if (error) throw new Error(`updateOrganisation: ${error.message}`);
  return data as OrganisationRow;
}

export type DeleteOrganisationResult = { status: 'deleted' } | { status: 'has_models'; count: number } | { status: 'not_found' };

/** Owner only, only when the organisation has no models (`atlas.delete_organisation`'s own module comment) — `jsonb` status, matching `deleteModel`'s own convention. */
export async function deleteOrganisation(supabase: Client, id: UUID): Promise<DeleteOrganisationResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('delete_organisation', { p_org_id: id });
  if (error) throw new Error(`deleteOrganisation: ${error.message}`);
  return data as DeleteOrganisationResult;
}

export interface MemberWithProfile {
  member: MemberRow;
  /** `null` only in the impossible-in-practice case `getProfile`'s own doc comment names (no row yet past first membership). */
  profile: ProfileRow | null;
}

/**
 * Sprint 7j item 2's member directory: "profiles, role, joined" — `members`
 * (`public`) and `atlas.profiles` (`atlas`) in two queries, the same
 * no-cross-schema-join shape `listOrgMemberProfiles` (`src/db/profiles.ts`)
 * already established for the @mention composer; this is the directory
 * page itself, the surface that function's own doc comment named as still
 * missing.
 */
export async function listMembers(supabase: Client, orgId: UUID): Promise<MemberWithProfile[]> {
  const { data, error } = await supabase.from('members').select('*').eq('org_id', orgId).order('joined_at');
  if (error) throw new Error(`listMembers: ${error.message}`);
  const members = (data as MemberRow[] | null) ?? [];
  const profiles = await listProfilesByIds(supabase, members.map((m) => m.user_id));
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  return members.map((member) => ({ member, profile: profileById.get(member.user_id) ?? null }));
}

/** Owner only (`members_update`'s RLS); `atlas.guard_last_owner` (`20260906071200_tenancy.sql`) refuses a demotion that would leave the org with none. */
export async function changeMemberRole(supabase: Client, orgId: UUID, userId: UUID, role: MemberRole): Promise<MemberRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('members').update({ role }).eq('org_id', orgId).eq('user_id', userId).select('*').single();
  if (error) throw new Error(`changeMemberRole: ${error.message}`);
  return data as MemberRow;
}

/** Owner removes anyone; anyone may remove themself (`members_delete`'s RLS) — `atlas.guard_last_owner` refuses removing the last owner either way. */
export async function removeMember(supabase: Client, orgId: UUID, userId: UUID): Promise<void> {
  const { error } = await supabase.from('members').delete().eq('org_id', orgId).eq('user_id', userId);
  if (error) throw new Error(`removeMember: ${error.message}`);
}

/** Owner or architect (`atlas.set_review_period`'s own check; `organisations_update` itself is owner-only): the organisation-wide number of days a reviewer has before a review is flagged overdue (1–90). */
export async function setReviewPeriod(supabase: Client, orgId: UUID, days: number): Promise<OrganisationRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_review_period', { p_org_id: orgId, p_days: days });
  if (error) throw new Error(`setReviewPeriod: ${error.message}`);
  return data as OrganisationRow;
}

/** The organisation's review period in days — one small read for the pages that only need to know when a review is overdue. */
export async function getReviewPeriodDays(supabase: Client, orgId: UUID): Promise<number> {
  const { data, error } = await supabase.from('organisations').select('review_period_days').eq('id', orgId).single();
  if (error) throw new Error(`getReviewPeriodDays: ${error.message}`);
  const row: Pick<OrganisationRow, 'review_period_days'> = data;
  return row.review_period_days;
}

/** Owner or architect (`atlas.set_stale_threshold`'s own check): the organisation-wide number of months a value can go unchecked before it is flagged stale (1–60). */
export async function setStaleThreshold(supabase: Client, orgId: UUID, months: number): Promise<OrganisationRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_stale_threshold', { p_org_id: orgId, p_months: months });
  if (error) throw new Error(`setStaleThreshold: ${error.message}`);
  return data as OrganisationRow;
}

async function staleMonthsOfOrganisation(supabase: Client, orgId: UUID, caller: string): Promise<number> {
  const { data, error } = await supabase.from('organisations').select('stale_after_months').eq('id', orgId).single();
  if (error) throw new Error(`${caller}: ${error.message}`);
  return Number(data.stale_after_months);
}

/** The stale threshold of the organisation a model belongs to — for readers that have a model id but not the organisation row (the AI tools' context). */
export async function getStaleAfterMonthsForModel(supabase: Client, modelId: UUID): Promise<number> {
  const { data, error } = await supabase.from('models').select('org_id').eq('id', modelId).single();
  if (error) throw new Error(`getStaleAfterMonthsForModel: ${error.message}`);
  return staleMonthsOfOrganisation(supabase, String(data.org_id), 'getStaleAfterMonthsForModel');
}

/** The same, for a commit — the finding reports are given a commit, not a model. */
export async function getStaleAfterMonthsForCommit(supabase: Client, commitId: UUID): Promise<number> {
  const { data, error } = await supabase.from('commits').select('org_id').eq('id', commitId).single();
  if (error) throw new Error(`getStaleAfterMonthsForCommit: ${error.message}`);
  return staleMonthsOfOrganisation(supabase, String(data.org_id), 'getStaleAfterMonthsForCommit');
}
