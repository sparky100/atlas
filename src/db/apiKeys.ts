/**
 * Read-only API keys (docs/ADR-031-read-only-api.md). Thin, typed wrappers
 * over the `api_keys` table (owner-readable, `key_hash` not selectable) and
 * the two owner-only functions that create and revoke keys. The full key is
 * only ever in `createApiKey`'s return value.
 */
import type { UUID } from '../contracts/delta';
import type { ApiKeyRow, CreatedApiKey } from '../contracts/api';
import type { Client } from './client';

const COLUMNS = 'id, org_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at';

/** Newest first. An organisation holds at most 20 active keys (the revoked ones stay listed), so one read is bounded in practice. */
export async function listApiKeys(supabase: Client, orgId: UUID): Promise<ApiKeyRow[]> {
  const { data, error } = await supabase.from('api_keys').select(COLUMNS).eq('org_id', orgId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`listApiKeys: ${error.message}`);
  return data;
}

/** Owner only. Returns the key (`token`) once; it cannot be read back. */
export async function createApiKey(supabase: Client, orgId: UUID, name: string): Promise<CreatedApiKey> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
  const { data, error } = await supabase.schema('atlas').rpc('create_api_key', { p_org_id: orgId, p_name: name });
  if (error) throw new Error(error.message);
  const row = (data as CreatedApiKey[] | null)?.[0];
  if (!row) throw new Error('createApiKey: no key returned.');
  return row;
}

/** Owner only. The key stops working at once; its row stays in the list. */
export async function revokeApiKey(supabase: Client, keyId: UUID): Promise<void> {
  const { error } = await supabase.schema('atlas').rpc('revoke_api_key', { p_key_id: keyId });
  if (error) throw new Error(error.message);
}
