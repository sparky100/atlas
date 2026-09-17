import { useCallback, useEffect, useState } from 'react';
import { getLlmProxyConfig, setLlmProxyConfig, type SetLlmProxyConfigInput } from '../../db/llmProxyConfig';
import { reportError } from '../errors/errorBannerStore';
import { reportToast } from '../toasts/toastStore';
import { supabase } from '../supabaseClient';

/** Kept in sync by hand with `llm-proxy`'s own env-var fallback defaults (`supabase/functions/llm-proxy/index.ts`'s `DEFAULT_MODEL`/`DEFAULT_RATE_LIMIT_PER_HOUR`) — Postgres/Deno can't share a TS constant, same cross-runtime duplication `src/contracts/llmProxy.ts`'s own module comment already notes. Used to pre-fill the form when no override row exists yet, so a first save always has valid values to submit. */
export const DEFAULT_LLM_PROXY_MODEL = 'claude-opus-5';
export const DEFAULT_LLM_PROXY_RATE_LIMIT_PER_HOUR = 100;

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
  model: string;
  rateLimitPerHour: number;
  hasApiKey: boolean;
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
    [model, rateLimitPerHour, hasApiKey],
  );

  return { status, error, model, rateLimitPerHour, hasApiKey, setModel, setRateLimitPerHour, save };
}
