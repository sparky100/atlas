/**
 * F7 item 4: cross-org model sharing. Thin, typed wrappers — same
 * untyped-client `eslint-disable` boundary `branches.ts`'s own module
 * comment names.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { ModelShareRow } from './types';

export interface CreateModelShareInput {
  /** Minted by the caller — never generated here (same convention `invites.ts`'s `createInvite` already uses). */
  id: UUID;
  modelId: UUID;
  /** Null shares "current main"; set shares exactly that one tagged version. */
  tagId: UUID | null;
  sharedWithOrgId: UUID;
  createdBy: UUID;
}

/** Owner-only (`model_shares_insert`'s RLS, checked against the model's own org). */
export async function createModelShare(supabase: Client, input: CreateModelShareInput): Promise<ModelShareRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('model_shares').insert({ id: input.id, model_id: input.modelId, tag_id: input.tagId, shared_with_org_id: input.sharedWithOrgId, created_by: input.createdBy }).select('*').single();
  if (error) throw new Error(`createModelShare: ${error.message}`);
  return data as ModelShareRow;
}

/** Owner-only (`model_shares_select`'s own "member of the model's own org sees every share on it" clause) — every share on one model, for the owner managing them. */
export async function listSharesForModel(supabase: Client, modelId: UUID): Promise<ModelShareRow[]> {
  const { data, error } = await supabase.from('model_shares').select('*').eq('model_id', modelId).order('created_at', { ascending: false });
  if (error) throw new Error(`listSharesForModel: ${error.message}`);
  return (data as ModelShareRow[] | null) ?? [];
}

/** Owner-only (`model_shares_delete`'s RLS) — revoke means delete, same "no soft-revoke state" stance `invites.ts`'s `revokeInvite` already takes; re-sharing later is a fresh row, not a resurrection. */
/**
 * A blocked delete under RLS isn't a Postgres error on its own — the
 * `model_shares_delete` policy's `using` clause just excludes the row from
 * the scan, so a bare `.delete()` reports an ordinary zero-row success.
 * `.select('id')` and an explicit empty-result check turn that into a real,
 * throwable failure (found live: another org's owner could "revoke" a
 * share they don't own with no error).
 */
export async function revokeModelShare(supabase: Client, id: UUID): Promise<void> {
  const { data, error } = await supabase.from('model_shares').delete().eq('id', id).select('id');
  if (error) throw new Error(`revokeModelShare: ${error.message}`);
  if (data.length === 0) throw new Error('revokeModelShare: not permitted or share not found');
}

export interface ModelSharedWithOrg {
  share: ModelShareRow;
  modelId: UUID;
  modelName: string;
  modelSlug: string;
  /** The model's own (owning) organisation — never the viewer's own org, which is always `sharedWithOrgId`. */
  ownerOrgId: UUID;
  ownerOrgName: string;
  ownerOrgSlug: string;
  /** Resolved tag name, only when the share is pinned — `null` for an unpinned ("current main") share. */
  tagName: string | null;
}

/**
 * OrgHome's "Shared with us": every model shared into `orgId` from
 * elsewhere. `model_shares_select`'s own "member of a shared_with org
 * sees only the share(s) extended to their own org" clause already scopes
 * this correctly — no need to filter `shared_with_org_id` again client-side,
 * though this function still does (defence in depth, same convention
 * every other org-scoped list query in this codebase already follows,
 * matching `listMembers`/`listInvites`'s own explicit `.eq(org_id, ...)`).
 * Three small follow-up reads (models/organisations/tags), never an
 * `.in()` over a caller-supplied id list that grows with the model
 * (CLAUDE.md rule 8) — bounded by however many shares exist for this org,
 * which is small by construction (a deliberate cross-org grant, not
 * ordinary model content).
 */
export async function listModelsSharedWithOrg(supabase: Client, orgId: UUID): Promise<ModelSharedWithOrg[]> {
  const { data: shareRows, error: shareError } = await supabase.from('model_shares').select('*').eq('shared_with_org_id', orgId).order('created_at', { ascending: false });
  if (shareError) throw new Error(`listModelsSharedWithOrg: ${shareError.message}`);
  const shares = (shareRows as ModelShareRow[] | null) ?? [];
  if (shares.length === 0) return [];

  const modelIds = [...new Set(shares.map((s) => s.model_id))];
  const { data: modelRows, error: modelError } = await supabase.from('models').select('id, org_id, name, slug').in('id', modelIds);
  if (modelError) throw new Error(`listModelsSharedWithOrg (models): ${modelError.message}`);
  const modelsById = new Map(((modelRows as { id: UUID; org_id: UUID; name: string; slug: string }[] | null) ?? []).map((m) => [m.id, m]));

  const ownerOrgIds = [...new Set([...modelsById.values()].map((m) => m.org_id))];
  const { data: orgRows, error: orgError } = await supabase.from('organisations').select('id, name, slug').in('id', ownerOrgIds);
  if (orgError) throw new Error(`listModelsSharedWithOrg (organisations): ${orgError.message}`);
  const orgsById = new Map(((orgRows as { id: UUID; name: string; slug: string }[] | null) ?? []).map((o) => [o.id, o]));

  const tagIds = [...new Set(shares.map((s) => s.tag_id).filter((id): id is UUID => id !== null))];
  let tagsById = new Map<UUID, string>();
  if (tagIds.length > 0) {
    const { data: tagRows, error: tagError } = await supabase.from('tags').select('id, name').in('id', tagIds);
    if (tagError) throw new Error(`listModelsSharedWithOrg (tags): ${tagError.message}`);
    tagsById = new Map(((tagRows as { id: UUID; name: string }[] | null) ?? []).map((t) => [t.id, t.name]));
  }

  const result: ModelSharedWithOrg[] = [];
  for (const share of shares) {
    const model = modelsById.get(share.model_id);
    if (!model) continue;
    const ownerOrg = orgsById.get(model.org_id);
    if (!ownerOrg) continue;
    result.push({
      share,
      modelId: model.id,
      modelName: model.name,
      modelSlug: model.slug,
      ownerOrgId: ownerOrg.id,
      ownerOrgName: ownerOrg.name,
      ownerOrgSlug: ownerOrg.slug,
      tagName: share.tag_id ? (tagsById.get(share.tag_id) ?? null) : null,
    });
  }
  return result;
}

/**
 * Owner-only, model-scoped (`atlas.list_share_target_org_names`'s own
 * inline ownership check — see that function's migration comment) — the
 * org names for `listSharesForModel`'s own management list, keyed by
 * `shared_with_org_id`. Never resolvable via a plain `organisations`
 * select: the owner isn't necessarily a member of every org they've
 * shared a model with.
 */
export async function listShareTargetOrgNames(supabase: Client, modelId: UUID): Promise<Map<UUID, string>> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('list_share_target_org_names', { p_model_id: modelId });
  if (error) throw new Error(`listShareTargetOrgNames: ${error.message}`);
  const rows = (data as { org_id: UUID; org_name: string }[] | null) ?? [];
  return new Map(rows.map((r) => [r.org_id, r.org_name]));
}

export type ResolveOrganisationForSharingResult = { status: 'found'; orgId: UUID; orgName: string } | { status: 'not_found' };

/**
 * The one narrow, deliberate crossing of `organisations_select`'s own
 * "you can't see an org you're not a member of" boundary — see the RPC's
 * own migration comment (`20260916020000_model_shares.sql`) for why this
 * exists and exactly how narrow it is (id + name only).
 */
export async function resolveOrganisationForSharing(supabase: Client, slug: string): Promise<ResolveOrganisationForSharingResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('resolve_organisation_for_sharing', { p_slug: slug });
  if (error) throw new Error(`resolveOrganisationForSharing: ${error.message}`);
  const rows = data as { id: UUID; name: string }[] | null;
  const row = rows?.[0];
  if (!row) return { status: 'not_found' };
  return { status: 'found', orgId: row.id, orgName: row.name };
}
