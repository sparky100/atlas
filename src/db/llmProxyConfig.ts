/**
 * The platform-admin-only path into `platform_config`'s own `'llm'` row
 * (`supabase/migrations/20260917030000_platform_admin.sql`'s
 * `atlas.get_platform_llm_config`/`atlas.set_platform_llm_config`) — the
 * table itself has no RLS policy at all; these two `security definer`
 * RPCs are the only client-reachable way in, alongside the `llm-proxy`
 * edge function's own service-role client. Never returns the raw API key
 * — only whether one is set — so nothing here ever displays or
 * round-trips a live secret.
 */
import type { Client } from './client';

export interface LlmProxyConfig {
  model: string | null;
  rateLimitPerHour: number | null;
  hasApiKey: boolean;
}

export type GetLlmProxyConfigResult = { status: 'ok'; config: LlmProxyConfig } | { status: 'error'; message: string };

/** `null` fields mean "no override set" — `useLlmProxyConfig.ts` fills in the same defaults `llm-proxy`'s own env-var fallback uses, so the form never starts blank. */
export async function getLlmProxyConfig(supabase: Client): Promise<GetLlmProxyConfigResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('get_platform_llm_config');
  if (error) return { status: 'error', message: error.message };
  const row = (data as { model: string | null; rate_limit_per_hour: number | null; has_api_key: boolean }[] | null)?.[0];
  if (!row) return { status: 'ok', config: { model: null, rateLimitPerHour: null, hasApiKey: false } };
  return { status: 'ok', config: { model: row.model, rateLimitPerHour: row.rate_limit_per_hour, hasApiKey: row.has_api_key } };
}

export interface SetLlmProxyConfigInput {
  model: string;
  rateLimitPerHour: number;
  /** Omit to leave the existing key (if any) untouched. */
  apiKey?: string;
  /** Explicitly remove a previously-set key, falling back to `llm-proxy`'s own `ANTHROPIC_API_KEY` secret. Mutually exclusive with `apiKey` in practice — the RPC checks `clearApiKey` first. */
  clearApiKey?: boolean;
}

export type SetLlmProxyConfigResult = { status: 'ok' } | { status: 'error'; message: string };

export async function setLlmProxyConfig(supabase: Client, input: SetLlmProxyConfigInput): Promise<SetLlmProxyConfigResult> {
  const { error } = await supabase.schema('atlas').rpc('set_platform_llm_config', {
    p_model: input.model,
    p_rate_limit_per_hour: input.rateLimitPerHour,
    p_api_key: input.apiKey ?? null,
    p_clear_api_key: input.clearApiKey ?? false,
  });
  if (error) return { status: 'error', message: error.message };
  return { status: 'ok' };
}
