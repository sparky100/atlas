/**
 * Microsoft Entra sign-in: an organisation's recorded Microsoft tenant, and
 * the once-per-sign-in join (`atlas.join_my_entra_org`). Thin, typed
 * wrappers — the rules live in the migration. Same untyped-client
 * `eslint-disable` boundary organisations.ts's own module comment names.
 */
import { isEntraJoinResult, type EntraJoinResult, type OrgEntraTenantRow } from '../contracts/entraTenant';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

/** Owner only (`org_entra_tenants_select`'s RLS) — the organisation's recorded tenant, or null if none. */
export async function getEntraTenant(supabase: Client, orgId: UUID): Promise<OrgEntraTenantRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('org_entra_tenants').select('*').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`getEntraTenant: ${error.message}`);
  return data as OrgEntraTenantRow | null;
}

/** Owner only. Records (or replaces) the organisation's tenant. The server's own messages ("already connected to another organisation") pass through, since they are written for people. */
export async function setEntraTenant(supabase: Client, orgId: UUID, tenantId: UUID): Promise<OrgEntraTenantRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_entra_tenant', { p_org_id: orgId, p_tenant_id: tenantId });
  if (error) throw new Error(error.message);
  return data as OrgEntraTenantRow;
}

/** Owner only. Stops anyone new joining by Microsoft sign-in; existing members stay. */
export async function clearEntraTenant(supabase: Client, orgId: UUID): Promise<void> {
  const { error } = await supabase.schema('atlas').rpc('clear_entra_tenant', { p_org_id: orgId });
  if (error) throw new Error(error.message);
}

/** Called after a sign-in. Reads the caller's own Microsoft identity server-side — never sends a tenant from the client. */
export async function joinMyEntraOrg(supabase: Client): Promise<EntraJoinResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('join_my_entra_org');
  if (error) throw new Error(`joinMyEntraOrg: ${error.message}`);
  if (!isEntraJoinResult(data)) throw new Error('joinMyEntraOrg: unexpected result');
  return data;
}
