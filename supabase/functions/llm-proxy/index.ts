/**
 * E4 (docs/prompts/atlas-prompt-pack.md), ADR-014: the shared LLM proxy —
 * "provider auth, rate limiting, per-organisation cost attribution,
 * prompt/response logging for audit... recommend extracting this
 * immediately." Ported from the existing suite's own real, deployed
 * `llm-proxy` (Des-Studio's `supabase/functions/llm-proxy/index.ts`), not
 * called across projects — see this repo's own ADR-014 amendment for why
 * (no shared package exists yet; Atlas gets its own deployment now,
 * porting the logic, rather than a runtime dependency on a second live
 * product). Narrowed in the port, deliberately:
 *
 * - **Anthropic only.** Des-Studio's own version routes across
 *   Anthropic/OpenAI/a multi-model gateway — none of that multi-provider
 *   surface is asked for by SPEC-capture.md K-10, which names a single
 *   default model. Provider choice stays server-side either way (the
 *   caller never picks a model), same principle, smaller surface.
 * - **No streaming to the caller — until the in-app help chat.** Capture is
 *   a background job, not an interactive chat UI, so its own `stream` field
 *   only ever asks for provider-side streaming behind one buffered JSON
 *   response (`src/contracts/llmProxy.ts`'s own module comment). The help
 *   chat (`src/ui/help/`) is a real interactive UI, so it opts into the one
 *   genuinely new thing this port adds back from Des-Studio: `streamToClient`
 *   (`normalizeRequest`/`callAnthropicStreamingPassthrough` below) forwards
 *   the provider's raw SSE to the browser as `text/event-stream`, same as
 *   Des-Studio's own `return new Response(upstream.body, ...)` — every other
 *   caller is completely unaffected, since this only activates when the
 *   caller explicitly sets `streamToClient: true`.
 * - **No audio transcription, no URL-fetch/readability extraction.** Both
 *   exist in Des-Studio's own version but are Lens-specific product
 *   features (an SSRF-guarded URL importer, Whisper/Deepgram voice notes),
 *   not "AI-assisted capture" in ADR-014's sense — out of scope here.
 * - **No `apiKeyPreview` on the status endpoint.** Des-Studio's own GET
 *   handler echoes the first 12 characters of the configured API key back
 *   to any caller who can reach it — not repeated here.
 *
 * `orgId` is required on every call: Atlas is genuinely multi-org
 * (ADR-017), so unlike Des-Studio's own single-tenant config, config
 * overrides here are never per-org — the caller's own forwarded session
 * must be a real member of the named org (`members_select`'s RLS is the
 * actual authorization check, re-derived here exactly like every other
 * edge function/RPC in this codebase, never trusted from the request
 * body); the org exists only so the call can be logged and rate-limited
 * against it. Every call — 'ok', 'error', or 'rate_limited' — is logged to
 * `llm_proxy_requests` (org, model, token counts, latency, status; never
 * the prompt or response content itself) via the service-role key, which
 * this function holds unlike `send-invite-email` (see that function's own
 * module comment) specifically because nothing in this schema lets an
 * ordinary member insert their own audit rows — the per-org rate limit is
 * simply a count of that same table's own rows in the last hour, so there
 * is nothing else to keep in sync.
 *
 * Resolved with the human directly (E4 follow-up): "LLM settings are
 * controlled at an application level" — model, rate-limit cap, and
 * optionally the API key itself are read from `platform_config`'s own
 * `key = 'llm'` row (`loadConfig` below), the same table/shape Des-Studio's
 * own `llm-proxy` already uses, before falling back field-by-field to this
 * function's own env-var secrets. Changing them is now an ordinary table
 * update (service-role/SQL — `platform_config` has no client access at
 * all, since a row here may hold a live secret), not `supabase secrets
 * set` + redeploy.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_RATE_LIMIT_PER_HOUR = 100;
const MAX_TOKENS_CEILING = 16000;
const DEFAULT_MAX_TOKENS = 1024;
const VALID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

type Role = 'system' | 'user' | 'assistant';
/** ADR-028 §3 (Ask Atlas), mirrors `src/contracts/llmProxy.ts` by hand: content is a string or a list of text / tool-call / tool-result blocks. */
type ProxyBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
interface ProxyMessage {
  role: Role;
  content: string | ProxyBlock[];
}
interface ProxyTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
interface ProxyToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ProxyOutputConfig {
  effort: string;
  format: { type: 'json_schema'; schema: Record<string, unknown> };
}
interface ProxyRequestBody {
  messages: ProxyMessage[];
  maxTokens: number;
  responseFormat: 'text' | 'json';
  /** F2 (full K1), SPEC-capture.md §3.5/§6 (K-10) — see `src/contracts/llmProxy.ts`'s own module comment for why these three are additive. */
  outputConfig?: ProxyOutputConfig;
  cacheControl?: boolean;
  stream?: boolean;
  /** See this file's own module comment — the in-app help chat's own passthrough-streaming opt-in. */
  streamToClient?: boolean;
  tools?: ProxyTool[];
  toolChoice?: 'auto' | 'none';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBlock(raw: unknown): ProxyBlock | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'text' && typeof raw.text === 'string') return raw.text.trim() === '' ? null : { type: 'text', text: raw.text };
  if (raw.type === 'tool_use' && typeof raw.id === 'string' && typeof raw.name === 'string' && isRecord(raw.input)) return { type: 'tool_use', id: raw.id, name: raw.name, input: raw.input };
  if (raw.type === 'tool_result' && typeof raw.toolUseId === 'string' && typeof raw.content === 'string') {
    return { type: 'tool_result', toolUseId: raw.toolUseId, content: raw.content, ...(raw.isError === true ? { isError: true } : {}) };
  }
  return null;
}

function normalizeContent(content: unknown): string | ProxyBlock[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks: ProxyBlock[] = [];
  for (const raw of content) {
    const block = normalizeBlock(raw);
    if (block) blocks.push(block);
  }
  return blocks;
}

function normalizeTools(raw: unknown): ProxyTool[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tools: ProxyTool[] = [];
  for (const t of raw) {
    if (isRecord(t) && typeof t.name === 'string' && t.name !== '' && typeof t.description === 'string' && isRecord(t.inputSchema)) {
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
    }
  }
  return tools.length > 0 ? tools : undefined;
}

/** The provider wants snake_case block keys; the proxy contract uses camelCase. */
function toProviderContent(content: string | ProxyBlock[]): string | Record<string, unknown>[] {
  if (typeof content === 'string') return content;
  return content.map((b) => {
    if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
    return b;
  });
}

/** Same three-role collapse `src/contracts/llmProxy.ts`'s own `normalizeRole` uses — kept in sync by hand across the runtime boundary (see that file's own module comment). */
function normalizeRole(role: unknown): Role {
  if (role === 'assistant' || role === 'assistant-confirm') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

/** Mirrors `src/contracts/llmProxy.ts`'s own `LlmProxyOutputConfig` shape check — a malformed `outputConfig` is dropped (never sent upstream as garbage) rather than rejecting the whole request, since `responseFormat` alone still produces a usable call. */
function normalizeOutputConfig(raw: unknown): ProxyOutputConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.effort !== 'string' || !VALID_EFFORTS.includes(r.effort)) return undefined;
  const format = r.format;
  if (typeof format !== 'object' || format === null) return undefined;
  const f = format as Record<string, unknown>;
  if (f.type !== 'json_schema' || typeof f.schema !== 'object' || f.schema === null) return undefined;
  return { effort: r.effort, format: { type: 'json_schema', schema: f.schema as Record<string, unknown> } };
}

function normalizeRequest(raw: unknown): ProxyRequestBody | Response {
  if (typeof raw !== 'object' || raw === null) {
    return jsonResponse({ status: 'error', message: 'A request body is required.' }, 400);
  }
  const r = raw as Record<string, unknown>;
  const rawMessages = Array.isArray(r.messages) ? r.messages : [];
  const messages: ProxyMessage[] = rawMessages
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({ role: normalizeRole(m.role), content: normalizeContent(m.content) }))
    .filter((m) => (typeof m.content === 'string' ? m.content.trim() !== '' : m.content.length > 0));
  if (messages.length === 0) {
    return jsonResponse({ status: 'error', message: 'At least one non-empty message is required.' }, 400);
  }
  const maxTokens = Math.min(Math.max(Math.trunc(Number(r.maxTokens) || DEFAULT_MAX_TOKENS), 1), MAX_TOKENS_CEILING);
  const responseFormat = r.responseFormat === 'json' ? 'json' : 'text';
  const outputConfig = normalizeOutputConfig(r.outputConfig);
  const cacheControl = r.cacheControl === true;
  const stream = r.stream === true;
  const streamToClient = r.streamToClient === true;
  // Mirrors `isValidLlmProxyRequest`'s own cross-field rule in
  // `src/contracts/llmProxy.ts` by hand (same runtime-boundary duplication
  // this file's own module comment already notes for the rest of this
  // shape): a passthrough with nothing to forward, or asked for alongside
  // structured JSON output, is rejected outright rather than silently
  // downgraded to a buffered response the caller didn't ask for.
  if (streamToClient && (!stream || responseFormat !== 'text' || outputConfig !== undefined)) {
    return jsonResponse({ status: 'error', message: 'streamToClient requires stream: true, responseFormat: "text", and no outputConfig.' }, 400);
  }
  const tools = normalizeTools(r.tools);
  const toolChoice = tools && r.toolChoice === 'none' ? 'none' : undefined;
  if (tools && outputConfig !== undefined) {
    return jsonResponse({ status: 'error', message: 'tools cannot be combined with outputConfig.' }, 400);
  }
  if (streamToClient && tools && toolChoice !== 'none') {
    return jsonResponse({ status: 'error', message: 'A streamed passthrough cannot carry tool calls; set toolChoice: "none".' }, 400);
  }
  return { messages, maxTokens, responseFormat, ...(outputConfig ? { outputConfig } : {}), cacheControl, stream, ...(streamToClient ? { streamToClient: true } : {}), ...(tools ? { tools } : {}), ...(toolChoice ? { toolChoice } : {}) };
}

interface AnthropicCallResult {
  ok: boolean;
  status: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
  cacheReadTokens?: number;
  toolCalls?: ProxyToolCall[];
}

/** Builds the upstream Messages API body — shared by the buffered and streaming paths so the two never drift on `system`/`output_config` shaping. */
function buildAnthropicBody(request: ProxyRequestBody, model: string, stream: boolean): Record<string, unknown> {
  const systemText = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')))
    .join('\n\n');
  const userMessages = request.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: toProviderContent(m.content) }));

  // §6.4: "no timestamps, job ids or user names inside the system block" — this
  // proxy never adds any; a cache-controlled prefix here is only ever exactly
  // what the caller sent as its own system-role content.
  const system =
    request.cacheControl && systemText
      ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
      : systemText || undefined;

  const body: Record<string, unknown> = { model, system, messages: userMessages, max_tokens: request.maxTokens, stream };
  if (request.tools) {
    body.tools = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    if (request.toolChoice === 'none') body.tool_choice = { type: 'none' };
  }
  if (request.outputConfig) {
    // `effort` is only honoured by a subset of models (Sonnet/Opus 4.6+,
    // Haiku 5.5+, Fable/Mythos); claude-haiku-4-5 rejects it with a 400
    // ("This model does not support the effort parameter"). Drop it for
    // Haiku 4.x (and only that) and send the structured-output format
    // alone, letting the model use its own default thinking; every other
    // model, Haiku 5.5 included, keeps the caller's per-prompt effort.
    const supportsEffort = !model.startsWith('claude-haiku-4');
    body.output_config = supportsEffort ? { effort: request.outputConfig.effort, format: request.outputConfig.format } : { format: request.outputConfig.format };
  }
  return body;
}

/** Non-streaming call — the original E4 path, unchanged in shape, now also surfacing `stop_reason` and cache-read tokens when the caller asked for `outputConfig`/`cacheControl`. */
async function callAnthropicBuffered(request: ProxyRequestBody, apiKey: string, model: string): Promise<AnthropicCallResult> {
  const upstream = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(buildAnthropicBody(request, model, false)),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return { ok: false, status: upstream.status, text: `Upstream ${String(upstream.status)}: ${detail || 'no body'}`, inputTokens: 0, outputTokens: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const data = await upstream.json();
  const contentBlocks: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[] = Array.isArray(data.content) ? data.content : [];
  const toolCalls: ProxyToolCall[] = contentBlocks
    .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
    .map((b) => ({ id: b.id as string, name: b.name as string, input: isRecord(b.input) ? b.input : {} }));
  const text = contentBlocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  const inputTokens = typeof data.usage?.input_tokens === 'number' ? data.usage.input_tokens : 0;
  const outputTokens = typeof data.usage?.output_tokens === 'number' ? data.usage.output_tokens : 0;
  const cacheReadTokens = typeof data.usage?.cache_read_input_tokens === 'number' ? data.usage.cache_read_input_tokens : undefined;
  const stopReason = typeof data.stop_reason === 'string' ? data.stop_reason : undefined;
  return { ok: true, status: upstream.status, text, inputTokens, outputTokens, stopReason, cacheReadTokens, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}

/**
 * Streaming call — K-10/§3.5: "streaming for the prose-extraction call (long
 * input)" so a long generation doesn't sit on one buffered upstream response
 * long enough to time out. Reads the provider's own SSE stream and
 * accumulates it into exactly the same shape `callAnthropicBuffered` returns
 * — this proxy's own HTTP response to its caller is never
 * `text/event-stream` (see `src/contracts/llmProxy.ts`'s module comment).
 */
async function callAnthropicStreaming(request: ProxyRequestBody, apiKey: string, model: string): Promise<AnthropicCallResult> {
  const upstream = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(buildAnthropicBody(request, model, true)),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return { ok: false, status: upstream.status, text: `Upstream ${String(upstream.status)}: ${detail || 'no body'}`, inputTokens: 0, outputTokens: 0 };
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let stopReason: string | undefined;

  const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (!payload) continue;
      let event: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === 'message_start') {
        const usage = (event.message as { usage?: Record<string, unknown> } | undefined)?.usage;
        if (typeof usage?.input_tokens === 'number') inputTokens = usage.input_tokens;
        if (typeof usage?.cache_read_input_tokens === 'number') cacheReadTokens = usage.cache_read_input_tokens;
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') text += delta.text;
      } else if (event.type === 'message_delta') {
        const delta = event.delta as { stop_reason?: string } | undefined;
        if (typeof delta?.stop_reason === 'string') stopReason = delta.stop_reason;
        const usage = event.usage as Record<string, unknown> | undefined;
        if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens;
      }
    }
  }

  return { ok: true, status: upstream.status, text, inputTokens, outputTokens, stopReason, cacheReadTokens };
}

function callAnthropic(request: ProxyRequestBody, apiKey: string, model: string): Promise<AnthropicCallResult> {
  return request.stream ? callAnthropicStreaming(request, apiKey, model) : callAnthropicBuffered(request, apiKey, model);
}

interface PassthroughResult {
  response: Response;
  /** Resolves once the stream this file's own caller reads has fully drained (success or failure) — so `Deno.serve`'s handler can await it and log exactly one `llm_proxy_requests` row per call, same as every other path, without blocking the first byte reaching the browser. */
  logged: Promise<{ status: 'ok' | 'error'; inputTokens: number; outputTokens: number }>;
}

/**
 * The in-app help chat's own path (`streamToClient`, this file's own module
 * comment): opens the same upstream SSE call `callAnthropicStreaming` does,
 * but instead of accumulating it into one buffered `AnthropicCallResult`,
 * forwards each raw chunk to this function's own caller immediately — the
 * exact bytes Anthropic sent, so the browser's own SSE parser
 * (`src/ui/help/streamHelpAnswer.ts`, the same `data:` line format Des-
 * Studio's `apiClient.js` already parses) needs no proxy-specific dialect.
 * Usage/stop-reason are parsed from the same bytes as they pass through,
 * purely for the post-stream audit log — never to alter what's forwarded.
 */
function callAnthropicStreamingPassthrough(request: ProxyRequestBody, apiKey: string, model: string): PassthroughResult {
  let resolveLogged!: (value: { status: 'ok' | 'error'; inputTokens: number; outputTokens: number }) => void;
  const logged = new Promise<{ status: 'ok' | 'error'; inputTokens: number; outputTokens: number }>((resolve) => {
    resolveLogged = resolve;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const upstream = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
          body: JSON.stringify(buildAnthropicBody(request, model, true)),
        });

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => '');
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: { message: `Upstream ${String(upstream.status)}: ${detail || 'no body'}` } })}\n\n`));
          controller.close();
          resolveLogged({ status: 'error', inputTokens: 0, outputTokens: 0 });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        for (const reader = upstream.body.getReader(); ;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Forwarded verbatim — this proxy never re-encodes what it just decoded to inspect it, so a caller reading raw bytes sees exactly what Anthropic sent.
          controller.enqueue(value);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice('data:'.length).trim();
            if (!payload) continue;
            let event: Record<string, unknown>;
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
              event = JSON.parse(payload);
            } catch {
              continue;
            }
            if (event.type === 'message_start') {
              const usage = (event.message as { usage?: Record<string, unknown> } | undefined)?.usage;
              if (typeof usage?.input_tokens === 'number') inputTokens = usage.input_tokens;
            } else if (event.type === 'message_delta') {
              const usage = event.usage as Record<string, unknown> | undefined;
              if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens;
            }
          }
        }
        controller.close();
        resolveLogged({ status: 'ok', inputTokens, outputTokens });
      } catch (e) {
        controller.error(e);
        resolveLogged({ status: 'error', inputTokens, outputTokens });
      }
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    }),
    logged,
  };
}

interface LlmProxyConfig {
  model: string;
  apiKey: string;
  rateLimitPerHour: number;
}

/** The saved provider key from Vault, or '' when none is saved or the function does not exist yet. */
async function loadVaultApiKey(supabaseUrl: string, serviceRoleKey: string): Promise<string> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/platform_llm_api_key`, {
      method: 'POST',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json', 'Content-Profile': 'atlas' },
      body: '{}',
    });
    if (!res.ok) return '';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const value = await res.json();
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/**
 * Application-level config (E4 follow-up) — reads `platform_config`'s own
 * `key = 'llm'` row (and the provider key from Vault) via a plain REST call under the service-role key (the
 * same shape Des-Studio's own `loadConfig()` uses), falling back
 * field-by-field to this function's own env-var secrets when the table has
 * no row, the fetch fails, or a given field isn't set on the row it does
 * have. A config-table value always wins over the env var when both are
 * present; the env var is the last resort, not a second source of truth to
 * reconcile.
 */
async function loadConfig(supabaseUrl: string, serviceRoleKey: string): Promise<LlmProxyConfig> {
  const envDefaults: LlmProxyConfig = {
    model: Deno.env.get('LLM_PROXY_MODEL') || DEFAULT_MODEL,
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    rateLimitPerHour: Number(Deno.env.get('LLM_PROXY_RATE_LIMIT_PER_HOUR')) || DEFAULT_RATE_LIMIT_PER_HOUR,
  };

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/platform_config?key=eq.llm&select=value`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!res.ok) {
      console.error('[llm-proxy] loadConfig: platform_config fetch failed', res.status);
      return envDefaults;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return envDefaults;
    const cfg: Record<string, unknown> = (rows[0] as { value?: Record<string, unknown> })?.value ?? {};
    // The saved key lives in Supabase Vault (atlas.platform_llm_api_key, service role only).
    // A legacy plain-text `apiKey` on the row is still honoured until the hardening
    // migration (20261114090000) moves it, so this function can be deployed first.
    const vaultKey = await loadVaultApiKey(supabaseUrl, serviceRoleKey);
    return {
      model: typeof cfg.model === 'string' && cfg.model !== '' ? cfg.model : envDefaults.model,
      apiKey: vaultKey !== '' ? vaultKey : typeof cfg.apiKey === 'string' && cfg.apiKey !== '' ? cfg.apiKey : envDefaults.apiKey,
      rateLimitPerHour: typeof cfg.rateLimitPerHour === 'number' && cfg.rateLimitPerHour > 0 ? cfg.rateLimitPerHour : envDefaults.rateLimitPerHour,
    };
  } catch (e) {
    console.error('[llm-proxy] loadConfig exception', e);
    return envDefaults;
  }
}

interface LogRequestInput {
  serviceClient: ReturnType<typeof createClient>;
  orgId: string;
  model: string;
  status: 'ok' | 'error' | 'rate_limited';
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

async function logRequest(input: LogRequestInput): Promise<void> {
  const { serviceClient, orgId, model, status, latencyMs, inputTokens, outputTokens } = input;
  const { error } = await serviceClient
    .from('llm_proxy_requests')
    .insert({ id: crypto.randomUUID(), org_id: orgId, model, status, latency_ms: latencyMs, input_tokens: inputTokens ?? null, output_tokens: outputTokens ?? null });
  // Logging is best-effort observability, not the authorization check
  // (that's the membership read below) — a failure here must never turn
  // an otherwise-successful proxy call into an error response.
  if (error) console.error('[llm-proxy] logRequest failed', error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);

  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({ status: 'error', message: 'Edge function is missing its own SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY — these are provided automatically by Supabase, this should not happen.' }, 500);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400);
    }
    const bodyRecord = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const orgId = typeof bodyRecord.orgId === 'string' ? bodyRecord.orgId : null;
    if (!orgId) return jsonResponse({ status: 'error', message: 'orgId is required.' }, 400);

    // The real authorization check: is the caller (their own forwarded
    // session, exactly like send-invite-email's identical pattern) a
    // member of this org at all? `members_select`'s RLS means this simply
    // returns nothing for a non-member — no separate permission check to
    // get wrong. But that policy lets a member see *every* member of their
    // org (not just their own row), so a plain `.maybeSingle()` would fail
    // with PostgREST's "multiple rows" error for any org with more than one
    // member — `.limit(1)` collapses it to "did any row come back", which is
    // the question actually being asked.
    const { data: membership, error: membershipError } = await callerClient.from('members').select('user_id').eq('org_id', orgId).limit(1).maybeSingle();
    if (membershipError) return jsonResponse({ status: 'error', message: `Could not verify membership: ${membershipError.message}` }, 500);
    if (!membership) return jsonResponse({ status: 'error', message: 'Not a member of this organisation.' }, 403);

    const proxyRequest = normalizeRequest(body);
    if (proxyRequest instanceof Response) return proxyRequest;

    // Agents run on the organisation's OWN key (Phase D, Simon 2026-11-19), never the platform key.
    // `useOrgKey: true` is allowed only when every switch is on (assistant, agents, a saved key) and
    // the caller is an owner or architect of the organisation. Otherwise it is refused outright: it
    // never falls back to the platform key, so an organisation without a key cannot spend ours.
    let orgApiKey: string | null = null;
    if (bodyRecord.useOrgKey === true) {
      const refuse = () => jsonResponse({ status: 'error', message: 'Agents are not available for this organisation: an owner needs to switch them on and save an AI key, and only an owner or architect can run them.' }, 403);
      const { data: userData, error: userError } = await callerClient.auth.getUser();
      if (userError || !userData.user) return refuse();
      const { data: own, error: ownError } = await callerClient.from('members').select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
      const role = (own as { role?: string } | null)?.role;
      if (ownError || (role !== 'owner' && role !== 'architect')) return refuse();
      const { data: orgRow, error: orgError } = await serviceClient.from('organisations').select('ai_assistant_enabled, ai_agents_enabled, ai_agent_key_set').eq('id', orgId).maybeSingle();
      const flags = orgRow as { ai_assistant_enabled?: boolean; ai_agents_enabled?: boolean; ai_agent_key_set?: boolean } | null;
      if (orgError || flags?.ai_assistant_enabled !== true || flags.ai_agents_enabled !== true || flags.ai_agent_key_set !== true) return refuse();
      const { data: savedKey, error: keyError } = await serviceClient.schema('atlas').rpc('org_ai_api_key', { p_org: orgId });
      if (keyError || typeof savedKey !== 'string' || savedKey === '') return refuse();
      orgApiKey = savedKey;
    }

    const config = await loadConfig(supabaseUrl, serviceRoleKey);
    const { model, rateLimitPerHour } = config;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await serviceClient
      .from('llm_proxy_requests')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', oneHourAgo);
    if (countError) console.error('[llm-proxy] rate-limit count failed', countError.message);
    if (!countError && (count ?? 0) >= rateLimitPerHour) {
      await logRequest({ serviceClient, orgId, model, status: 'rate_limited', latencyMs: Date.now() - startedAt });
      return jsonResponse({ status: 'error', message: `Rate limit exceeded for this organisation (${String(rateLimitPerHour)} requests/hour).` }, 429);
    }

    const apiKey = orgApiKey ?? config.apiKey;
    if (!apiKey) {
      await logRequest({ serviceClient, orgId, model, status: 'error', latencyMs: Date.now() - startedAt });
      return jsonResponse({ status: 'error', message: 'LLM proxy is not configured — no API key in platform_config\'s "llm" row or ANTHROPIC_API_KEY. See docs/EDGE-FUNCTIONS.md.' }, 503);
    }

    if (proxyRequest.streamToClient) {
      const passthrough = callAnthropicStreamingPassthrough(proxyRequest, apiKey, model);
      // The response streams to the browser immediately; the audit-log row
      // (`logRequest`, same table/shape every other path writes) is written
      // once `passthrough.logged` resolves, after this function has already
      // returned — `EdgeRuntime.waitUntil` (Deno Deploy's own mechanism for
      // exactly this) keeps the isolate alive for it. Falls back to a plain
      // fire-and-forget `.then()` when that global isn't present (e.g. a
      // local test runner), since a best-effort audit log must never block
      // or fail the response itself (`logRequest`'s own comment).
      const logAfterStream = passthrough.logged.then((outcome) => logRequest({ serviceClient, orgId, model, status: outcome.status, latencyMs: Date.now() - startedAt, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens }));
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime) runtime.waitUntil(logAfterStream);
      return passthrough.response;
    }

    const result = await callAnthropic(proxyRequest, apiKey, model);
    const latencyMs = Date.now() - startedAt;

    if (!result.ok) {
      await logRequest({ serviceClient, orgId, model, status: 'error', latencyMs });
      return jsonResponse({ status: 'error', message: result.text }, result.status);
    }

    await logRequest({ serviceClient, orgId, model, status: 'ok', latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return jsonResponse(
      {
        status: 'ok',
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
        ...(result.cacheReadTokens !== undefined ? { cacheReadTokens: result.cacheReadTokens } : {}),
        ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
      },
      200,
    );
  } catch (e) {
    return jsonResponse({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error calling the LLM proxy.' }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
