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
import { summariseTrial, type TrialUse } from '../contracts/trialAllowance';

/** Member-scoped (`llm_proxy_requests_select`'s RLS) — reverse-chronological. */
export async function listLlmProxyUsage(supabase: Client, orgId: UUID): Promise<LlmProxyRequestRow[]> {
  const { data, error } = await supabase.from('llm_proxy_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw new Error(`listLlmProxyUsage: ${error.message}`);
  return (data as LlmProxyRequestRow[] | null) ?? [];
}

export interface AgentUse {
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

/** Pure: totals for the rows an owner sees on the Agents card. Only successful calls on the organisation's own key count. */
export function summariseAgentUse(rows: readonly Pick<LlmProxyRequestRow, 'key_source' | 'status' | 'input_tokens' | 'output_tokens' | 'created_at'>[], since: Date): AgentUse {
  const use: AgentUse = { runs: 0, inputTokens: 0, outputTokens: 0 };
  for (const row of rows) {
    if (row.key_source !== 'org' || row.status !== 'ok' || new Date(row.created_at) < since) continue;
    use.runs += 1;
    use.inputTokens += row.input_tokens ?? 0;
    use.outputTokens += row.output_tokens ?? 0;
  }
  return use;
}

/** The first moment of the current calendar month, UTC. */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Calls made on the organisation's own key this month (member-scoped by RLS). One call is one model turn, so a Designer run is several. */
export async function agentUseThisMonth(supabase: Client, orgId: UUID, now: Date = new Date()): Promise<AgentUse> {
  const since = startOfMonthUtc(now);
  const { data, error } = await supabase
    .from('llm_proxy_requests')
    .select('key_source, status, input_tokens, output_tokens, created_at')
    .eq('org_id', orgId)
    .eq('key_source', 'org')
    .gte('created_at', since.toISOString());
  if (error) throw new Error(`agentUseThisMonth: ${error.message}`);
  return summariseAgentUse(data, since);
}

export interface DesignerTrialStatus extends TrialUse {
  /** Whether the organisation has saved its own AI key. With one, the trial no longer applies. */
  keySet: boolean;
}

/**
 * The Designer's free trial for an organisation: runs and tokens used and runs left (member-scoped by RLS;
 * counts only, never content). The proxy enforces the same rule itself, so this only decides what the page says.
 */
export async function designerTrialStatus(supabase: Client, orgId: UUID): Promise<DesignerTrialStatus> {
  const [{ data: rows, error }, { data: org, error: orgError }] = await Promise.all([
    supabase.from('llm_proxy_requests').select('key_source, status, run_id, input_tokens, output_tokens').eq('org_id', orgId).eq('key_source', 'trial').limit(2000),
    supabase.from('organisations').select('ai_agent_key_set').eq('id', orgId).maybeSingle(),
  ]);
  if (error) throw new Error(`designerTrialStatus: ${error.message}`);
  if (orgError) throw new Error(`designerTrialStatus: ${orgError.message}`);
  return { ...summariseTrial(rows), keySet: (org as { ai_agent_key_set?: boolean } | null)?.ai_agent_key_set === true };
}
