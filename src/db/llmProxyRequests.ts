/**
 * E4 (ADR-014) — read-only. Every row is written by the `llm-proxy` edge
 * function itself, via the service-role key (`llm_proxy_requests_select`'s
 * RLS is member-scoped; there is no insert/update/delete grant for
 * `authenticated` at all). No UI reads this yet — a future "LLM usage"
 * panel is the obvious consumer, not built as part of E4.
 */
import type { Client } from './client';
import type { LlmProxyRequestRow } from './types';
import type { UUID } from '../contracts/delta';

/** Member-scoped (`llm_proxy_requests_select`'s RLS) — reverse-chronological. */
export async function listLlmProxyUsage(supabase: Client, orgId: UUID): Promise<LlmProxyRequestRow[]> {
  const { data, error } = await supabase.from('llm_proxy_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw new Error(`listLlmProxyUsage: ${error.message}`);
  return (data as LlmProxyRequestRow[] | null) ?? [];
}
