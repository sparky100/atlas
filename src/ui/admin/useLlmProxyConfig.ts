import { useCallback, useEffect, useState } from 'react';
import { getLlmProxyConfig, setLlmProxyConfig, type SetLlmProxyConfigInput } from '../../db/llmProxyConfig';
import { reportError } from '../errors/errorBannerStore';
import { reportToast } from '../toasts/toastStore';
import { supabase } from '../supabaseClient';

/** Kept in sync by hand with `llm-proxy`'s own env-var fallback defaults (`supabase/functions/llm-proxy/index.ts`'s `DEFAULT_MODEL`/`DEFAULT_RATE_LIMIT_PER_HOUR`) — Postgres/Deno can't share a TS constant, same cross-runtime duplication `src/contracts/llmProxy.ts`'s own module comment already notes. Used to pre-fill the form when no override row exists yet, so a first save always has valid values to submit. */
export const DEFAULT_LLM_PROXY_PROVIDER = 'anthropic';
export const DEFAULT_LLM_PROXY_MODEL = 'claude-opus-5';
export const DEFAULT_LLM_PROXY_RATE_LIMIT_PER_HOUR = 100;

export interface LlmProxyProviderOption {
  id: string;
  label: string;
}

export interface LlmProxyModelOption {
  id: string;
  label: string;
}

/**
 * The provider choices `PlatformAdminView`'s picker offers. One entry
 * today — `llm-proxy` routes to Anthropic only, by ADR-014's own
 * deliberate scope narrowing — but this is a real, data-driven list, not
 * a hardcoded disabled option: the day `llm-proxy`'s own routing (and
 * `atlas.set_platform_llm_config`'s allow-list, `20260921020000_platform_llm_provider.sql`)
 * gains a second provider, adding it here is the entire UI change needed.
 */
export const LLM_PROXY_PROVIDER_OPTIONS: LlmProxyProviderOption[] = [{ id: 'anthropic', label: 'Anthropic' }];

/**
 * The model choices `PlatformAdminView`'s picker offers, for the
 * currently-selected provider. Held here by hand, same as
 * `DEFAULT_LLM_PROXY_MODEL` above: nothing on the Postgres/Deno side of
 * this boundary can share a TS constant, so this list needs updating by
 * hand as new Claude models ship.
 *
 * Ids are the exact, complete strings the Anthropic API expects for a
 * direct (non-Vertex) call — no date suffix (a prior version of this list
 * mistakenly appended one to the Haiku id; dated-snapshot ids are a Vertex
 * AI-only convention and are rejected here). Covers the current and prior
 * generation so an org already relying on an older model can still select
 * it after an upgrade, without needing a code change; excludes
 * `claude-mythos-5-1` (Project Glasswing-only access, not generally
 * available).
 */
export const LLM_PROXY_MODEL_OPTIONS: LlmProxyModelOption[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (flagship)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-fable-5', label: 'Claude Fable 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

export type LlmProxyConfigStatus = 'loading' | 'idle' | 'saving' | 'error';

export interface SaveLlmProxyConfigInput {
  /** Omit to leave an existing key (if any) untouched. */
  apiKey?: string;
  /** Explicitly remove a previously-set key. */
  clearApiKey?: boolean;
}

export interface UseLlmProxyConfigResult {
  status: LlmProxyConfigStatus;
  error: string | null;
  provider: string;
  model: string;
  rateLimitPerHour: number;
  hasApiKey: boolean;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setRateLimitPerHour: (rateLimitPerHour: number) => void;
  save: (input: SaveLlmProxyConfigInput) => Promise<boolean>;
}

/**
 * The `/platform-admin` page's own settings form — loads on mount (the
 * same `atlas.get_platform_llm_config` RPC every platform admin shares,
 * no per-org dimension), tracks the editable fields locally, and saves via
 * `atlas.set_platform_llm_config`. Never holds the raw API key in state —
 * only `hasApiKey`, matching the RPC's own "never returns the key" design
 * (`src/db/llmProxyConfig.ts`'s module comment).
 */
export function useLlmProxyConfig(): UseLlmProxyConfigResult {
  const [status, setStatus] = useState<LlmProxyConfigStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState(DEFAULT_LLM_PROXY_PROVIDER);
  const [model, setModel] = useState(DEFAULT_LLM_PROXY_MODEL);
  const [rateLimitPerHour, setRateLimitPerHour] = useState(DEFAULT_LLM_PROXY_RATE_LIMIT_PER_HOUR);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getLlmProxyConfig(supabase)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'error') {
          reportError("Couldn't load LLM proxy settings.", new Error(result.message));
          setError(result.message);
          setStatus('error');
          return;
        }
        setProvider(result.config.provider ?? DEFAULT_LLM_PROXY_PROVIDER);
        setModel(result.config.model ?? DEFAULT_LLM_PROXY_MODEL);
        setRateLimitPerHour(result.config.rateLimitPerHour ?? DEFAULT_LLM_PROXY_RATE_LIMIT_PER_HOUR);
        setHasApiKey(result.config.hasApiKey);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        reportError("Couldn't load LLM proxy settings.", e);
        setError(e instanceof Error ? e.message : 'Could not load LLM proxy settings.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (input: SaveLlmProxyConfigInput): Promise<boolean> => {
      setError(null);
      setStatus('saving');
      const setInput: SetLlmProxyConfigInput = {
        provider,
        model,
        rateLimitPerHour,
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
        ...(input.clearApiKey !== undefined ? { clearApiKey: input.clearApiKey } : {}),
      };
      const result = await setLlmProxyConfig(supabase, setInput);
      if (result.status === 'error') {
        setStatus('idle');
        setError(result.message);
        return false;
      }
      setHasApiKey(input.clearApiKey === true ? false : input.apiKey !== undefined ? true : hasApiKey);
      setStatus('idle');
      reportToast('LLM proxy settings saved');
      return true;
    },
    [provider, model, rateLimitPerHour, hasApiKey],
  );

  return { status, error, provider, model, rateLimitPerHour, hasApiKey, setProvider, setModel, setRateLimitPerHour, save };
}
