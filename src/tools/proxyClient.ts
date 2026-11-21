/**
 * ADR-028 §3: the `AskModelClient` that goes through `llm-proxy`, so provider
 * auth, the per-organisation rate limit and cost logging stay in one place.
 * The caller's own session token is forwarded (the proxy re-checks
 * membership with it); the service-role key is never involved. `fetch` is
 * injected so this is tested without a network.
 */
import { buildLlmProxyRequest } from '../contracts/llmProxy';
import type { LlmProxyResponse, LlmProxyToolCall } from '../contracts/llmProxy';
import type { AskModelClient, AskModelResponse } from './askLoop';

/** A failure from the proxy or the provider, with the HTTP status the proxy gave (429 = the organisation's hourly cap). */
export class AskProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AskProviderError';
  }
}

export interface ProxyAskClientOptions {
  proxyUrl: string;
  /** The caller's `Authorization` header value, forwarded as is. */
  authorization: string;
  anonKey: string;
  orgId: string;
  /** Phase D: run on the organisation's own key, never the platform key. The proxy refuses unless agents are switched on, a key is saved and the caller is an owner or architect. */
  useOrgKey?: boolean;
  /** The Designer's id for this run. With no saved key the proxy runs the free trial and counts runs by this id. */
  runId?: string;
  /** D2: refuse unless the organisation has its own saved key — never fall back to the trial or platform key. */
  requireOrgKey?: boolean;
  /** D2: `'light'` asks for a cheaper server-chosen model; the proxy honours it only with the organisation's own key. */
  modelTier?: 'light';
  fetchFn?: typeof fetch;
}

function isToolCall(value: unknown): value is LlmProxyToolCall {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.input === 'object' && v.input !== null;
}

export function createProxyAskClient(options: ProxyAskClientOptions): AskModelClient {
  const doFetch = options.fetchFn ?? fetch;
  return {
    complete: async (request): Promise<AskModelResponse> => {
      const proxyRequest = buildLlmProxyRequest({
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        maxTokens: request.maxTokens,
        tools: request.tools,
        toolChoice: request.toolChoice,
        cacheControl: true,
        ...(options.modelTier === 'light' ? { modelTier: 'light' as const } : {}),
      });
      const res = await doFetch(options.proxyUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: options.authorization, apikey: options.anonKey },
        body: JSON.stringify({ orgId: options.orgId, ...(options.useOrgKey === true ? { useOrgKey: true } : {}), ...(options.requireOrgKey === true ? { requireOrgKey: true } : {}), ...(options.runId !== undefined ? { runId: options.runId } : {}), ...proxyRequest }),
      });
      const body = (await res.json().catch(() => null)) as (Partial<LlmProxyResponse> & { status?: string; message?: string }) | null;
      if (!res.ok || !body || body.status === 'error') {
        throw new AskProviderError(res.status, body?.message ?? `The AI service returned ${String(res.status)}.`);
      }
      return {
        text: body.text ?? '',
        ...(body.stopReason !== undefined ? { stopReason: body.stopReason } : {}),
        ...(body.toolCalls ? { toolCalls: body.toolCalls.filter(isToolCall) } : {}),
        inputTokens: body.inputTokens ?? 0,
        outputTokens: body.outputTokens ?? 0,
      };
    },
  };
}
