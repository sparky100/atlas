/**
 * Browser-side streaming client for the Help chat — the one caller in
 * Atlas that sets `streamToClient: true` (`src/contracts/llmProxy.ts`'s own
 * comment) and reads a real `text/event-stream` response back from
 * `llm-proxy`. Ported from Des-Studio's own `src/llm/apiClient.js`
 * `streamNarrative` (the proven SSE-reading logic — `response.body.
 * getReader()`, blank-line-delimited `data:` chunks, `.delta.text`), wired
 * to Atlas's own auth (forwarded session JWT + `orgId`, `src/capture/llm/
 * client.ts`'s `ProxyLlmClient`) and wire contract (`buildLlmProxyRequest`)
 * instead of Des-Studio's own `contracts.js`.
 *
 * `supabase.functions.invoke` isn't used here (unlike `capture-run`/`send-
 * invite-email`, `src/db/captureJobs.ts`/`src/db/invites.ts`) because it
 * buffers the whole response rather than exposing a readable stream — a
 * plain `fetch` is the only way to read Server-Sent Events token by token.
 */
import { buildLlmProxyRequest, isValidLlmProxyRequest, type LlmProxyMessage } from '../../contracts/llmProxy';
import { loadBrowserEnv } from '../env';

export interface StreamHelpAnswerCallbacks {
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

function proxyUrl(): string {
  return `${loadBrowserEnv().VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/llm-proxy`;
}

function extractTokenFromSsePayload(payload: string): string {
  if (!payload || payload === '[DONE]') return '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the provider's own SSE event shape, read defensively field-by-field below.
    const data = JSON.parse(payload);
    const delta = (data as { delta?: { text?: string } }).delta;
    return typeof delta?.text === 'string' ? delta.text : '';
  } catch {
    return '';
  }
}

/** Same blank-line/`data:`-line parsing Des-Studio's own `apiClient.js` `consumeSseChunk` uses — the wire format is Anthropic's own Messages API SSE, forwarded byte-for-byte by `llm-proxy`'s `callAnthropicStreamingPassthrough`. */
export function consumeSseChunk(chunk: string, onToken: (token: string) => void): void {
  const events = chunk.split(/\n\n+/);
  for (const event of events) {
    const lines = event.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice('data:'.length).trim());
    if (dataLines.length === 0) continue;
    const token = extractTokenFromSsePayload(dataLines.join('\n'));
    if (token) onToken(token);
  }
}

export interface StreamHelpAnswerInput {
  orgId: string;
  messages: readonly LlmProxyMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** Test-only seam, same shape as `ProxyLlmClientConfig.fetchImpl` (`src/capture/llm/client.ts`) — defaults to the real `fetch`. */
  fetchImpl?: typeof fetch;
  /** Test-only seam — defaults to the real browser session's access token via `supabase.auth.getSession()`. */
  getAccessToken?: () => Promise<string | null>;
  /** Test-only seam — defaults to `${VITE_SUPABASE_URL}/functions/v1/llm-proxy`, which needs real browser env vars a unit test doesn't have. */
  proxyUrl?: string;
}

/** Imported lazily — same reasoning as `DirectLlmClient`'s own lazy `@anthropic-ai/sdk` import (`src/capture/llm/client.ts`'s own comment): importing this whole module must not eagerly construct the app's singleton Supabase client (`../supabaseClient` reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` at module load), which would fail in any context (a unit test, a future non-browser caller) that never actually calls the real default and only ever passes its own `getAccessToken`. */
async function defaultGetAccessToken(): Promise<string | null> {
  const { supabase } = await import('../supabaseClient');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** Streams one Help-chat turn — resolves once the stream ends (success or a caught error is instead reported via `onError`, never thrown). Never called with `outputConfig`/`responseFormat: 'json'`: the wire contract's own cross-field rule (`isValidLlmProxyRequest`) would reject a `streamToClient` request built that way. */
export async function streamHelpAnswer(input: StreamHelpAnswerInput, { onToken, onComplete, onError }: StreamHelpAnswerCallbacks): Promise<void> {
  try {
    const accessToken = await (input.getAccessToken ?? defaultGetAccessToken)();
    const fetchImpl = input.fetchImpl ?? fetch;
    const proxyRequest = buildLlmProxyRequest({
      messages: input.messages,
      maxTokens: input.maxTokens ?? 2000,
      responseFormat: 'text',
      streamToClient: true,
    });
    if (!isValidLlmProxyRequest(proxyRequest)) {
      throw new Error('streamHelpAnswer built a request the proxy contract itself would reject — this should not happen.');
    }

    const response = await fetchImpl(input.proxyUrl ?? proxyUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ...proxyRequest, orgId: input.orgId }),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Help assistant request failed (${String(response.status)})${detail ? `: ${detail}` : ''}`);
    }
    if (!response.body) {
      throw new Error('Help assistant response had no body to stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consumeSseChunk(decoder.decode(value, { stream: true }), onToken);
    }
    onComplete();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    onError(error instanceof Error ? error : new Error('Unknown error streaming the Help assistant response.'));
  }
}
