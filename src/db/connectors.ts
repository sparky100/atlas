/**
 * Live connectors (docs/ADR-032-connectors.md). Thin, typed wrappers over
 * `org_connectors` (owner/architect-readable, `secret_id` not selectable),
 * the two owner-only functions that save and remove one, and the
 * `connector-fetch` edge function. The secret goes in through `saveConnector`
 * and is never readable again.
 */
import type { UUID } from '../contracts/delta';
import type { ConnectorFetchMode, ConnectorFetchResponse, ConnectorKind, ConnectorRow } from '../contracts/connectors';
import type { Client } from './client';

const COLUMNS = 'id, org_id, kind, config, created_by, created_at, updated_at, last_fetch_at, last_fetch_status, last_fetch_message';

export async function listConnectors(supabase: Client, orgId: UUID): Promise<ConnectorRow[]> {
  const { data, error } = await supabase.from('org_connectors').select(COLUMNS).eq('org_id', orgId).order('created_at');
  if (error) throw new Error(`listConnectors: ${error.message}`);
  return data;
}

/** Owner only. `secret` may be empty when changing the settings of a connector that already has one saved. */
export async function saveConnector(supabase: Client, orgId: UUID, kind: ConnectorKind, config: Record<string, unknown>, secret: string): Promise<void> {
  const { error } = await supabase.schema('atlas').rpc('save_connector', { p_org_id: orgId, p_kind: kind, p_config: config, p_secret: secret });
  if (error) throw new Error(error.message);
}

/** Owner only. Removes the connector and its stored secret. */
export async function removeConnector(supabase: Client, orgId: UUID, kind: ConnectorKind): Promise<void> {
  const { error } = await supabase.schema('atlas').rpc('remove_connector', { p_org_id: orgId, p_kind: kind });
  if (error) throw new Error(error.message);
}

/** Owner or architect. `test` checks the settings; `fetch` returns the file the import dialog reads. */
export async function runConnector(supabase: Client, orgId: UUID, kind: ConnectorKind, mode: ConnectorFetchMode): Promise<ConnectorFetchResponse> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
  const { data, error } = await supabase.functions.invoke('connector-fetch', { body: { orgId, kind, mode } });
  if (error) return { status: 'error', code: 'failed', message: 'Could not reach the connector service. Check that it has been deployed, then try again.' };
  const result = data as ConnectorFetchResponse | null;
  return result ?? { status: 'error', code: 'failed', message: 'The connector service gave no answer.' };
}

/** The connector of one kind in a list, if the organisation has set it up. */
export function findConnector(rows: readonly ConnectorRow[], kind: string): ConnectorRow | null {
  return rows.find((row) => row.kind === kind) ?? null;
}
