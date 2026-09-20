/**
 * F2 (full K1), SPEC-capture.md §3.5/§6 (K-10): the one seam every capture
 * prompt calls through. `LlmClient.complete()` is the interface; three
 * implementations sit behind it, chosen by environment, never by capture's
 * own extraction/matching/classification code (`src/capture/prompts/*`,
 * PR5/PR6/PR11) — that code only ever sees `LlmClient`.
 *
 * `stop_reason` is checked here, once, before any caller can read `.text`
 * (§3.5: "`refusal` and `max_tokens` are failure modes (§11), never parsed
 * as partial output") — every implementation below routes its raw response
 * through `finalizeResponse`, so there is no path back to a caller that
 * skips the check.
 */
import type { LlmProxyEffort, LlmProxyMessage } from '../../contracts/llmProxy';
import { buildLlmProxyRequest, isValidLlmProxyRequest } from '../../contracts/llmProxy';

/** §6: prompt A/C `medium`, prompt B `high` — the full set the provider accepts, so a future prompt can use `xhigh`/`max` without a contract change. */
export type LlmEffort = LlmProxyEffort;

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmSchemaFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Falls back to each client's own configured model when omitted. */
  model?: string;
  maxTokens?: number;
  effort: LlmEffort;
  /** The stable, cache-controlled system block (§6.4) — frozen prompt text, never volatile content. */
  system: string;
  format: LlmSchemaFormat;
  messages: readonly LlmMessage[];
  /** §3.5: "streaming for the prose-extraction call (long input)" — the caller (prompt B, PR11) opts in; prompts A/C leave this unset. Never changes the shape of `LlmResponse`. */
  stream?: boolean;
}

/** The provider's own stop-reason vocabulary, widened to `string` for whatever value a future model/provider adds — `finalizeResponse` only special-cases `'refusal'`/`'max_tokens'`. */
export type LlmStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'tool_use' | 'pause_turn' | (string & {});

export interface LlmResponse {
  text: string;
  stopReason: LlmStopReason;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** §11 `LLM_REFUSAL`: the model declined to respond. */
export class LlmRefusalError extends Error {
  readonly code = 'LLM_REFUSAL';
  constructor() {
    super('The model refused to respond (stop_reason: refusal).');
    this.name = 'LlmRefusalError';
  }
}

/** §11 `LLM_TRUNCATED`: the response hit `max_tokens` — the orchestrator (PR10/PR12) retries once with the chunk split in half, then surfaces `error`. No partial text is attached: §3.5 rules a truncated response out as something any caller could legitimately read. */
export class LlmTruncatedError extends Error {
  readonly code = 'LLM_TRUNCATED';
  constructor() {
    super('The model response was truncated (stop_reason: max_tokens).');
    this.name = 'LlmTruncatedError';
  }
}

/** §11 `LLM_SCHEMA_INVALID`: "should not happen with structured outputs; defensive." Thrown by a client implementation when the provider's own response doesn't match the shape structured outputs promise (e.g. no text block at all). */
export class LlmSchemaInvalidError extends Error {
  readonly code = 'LLM_SCHEMA_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'LlmSchemaInvalidError';
  }
}

export const DEFAULT_CAPTURE_MODEL = 'claude-opus-5';
export const DEFAULT_CAPTURE_MAX_TOKENS = 16000;

interface RawLlmResult {
  text: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** The one place `stop_reason` is checked before `content` is read (§3.5) — every client implementation's own raw provider result flows through here, never returned to a caller directly. */
function finalizeResponse(raw: RawLlmResult): LlmResponse {
  if (raw.stopReason === 'refusal') throw new LlmRefusalError();
  if (raw.stopReason === 'max_tokens') throw new LlmTruncatedError();
  return { text: raw.text, stopReason: raw.stopReason, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens, cacheReadTokens: raw.cacheReadTokens };
}

function toProxyMessages(request: LlmRequest): LlmProxyMessage[] {
  return [{ role: 'system', content: request.system }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))];
}

export interface ProxyLlmClientConfig {
  /** The deployed `llm-proxy` edge function's URL (typically `${SUPABASE_URL}/functions/v1/llm-proxy`). */
  proxyUrl: string;
  /**
   * Forwarded as `Authorization: Bearer <authToken>` — the real check the
   * deployed `llm-proxy` performs (`supabase/functions/llm-proxy/index.ts`)
   * is that this token's own session is a member of `orgId`. From the
   * browser this is the caller's own session JWT; from `capture-run`
   * (§3.5, PR12) it is that function's own service-role key, forwarded
   * after `capture-run`'s own JWT-based authorization already ran.
   *
   * (SPEC-capture.md §3.5's prose names a static `LLM_PROXY_KEY` header
   * and `x-atlas-org-id` — that predates the real, already-built E4
   * contract, which authorizes by forwarded caller identity and reads
   * `orgId` from the JSON body; this client matches the real contract,
   * and the doc line is corrected alongside this PR.)
   */
  authToken: string;
  orgId: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface LlmProxyHttpResponse {
  status: 'ok' | 'error';
  message?: string;
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  cacheReadTokens?: number;
}

/** §3.5: "POSTs the body to [the proxy]... the proxy is a pass-through to the Messages API." Used when the shared proxy is configured — the browser and `capture-run` both go through it; the provider key never reaches either. */
export class ProxyLlmClient implements LlmClient {
  constructor(private readonly config: ProxyLlmClientConfig) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const proxyRequest = buildLlmProxyRequest({
      messages: toProxyMessages(request),
      maxTokens: request.maxTokens ?? DEFAULT_CAPTURE_MAX_TOKENS,
      responseFormat: 'json',
      outputConfig: { effort: request.effort, format: request.format },
      cacheControl: true,
      ...(request.stream ? { stream: true } : {}),
    });
    if (!isValidLlmProxyRequest(proxyRequest)) {
      throw new LlmSchemaInvalidError('ProxyLlmClient built a request buildLlmProxyRequest itself would reject — this should not happen.');
    }

    const fetchImpl = this.config.fetchImpl ?? fetch;
    const res = await fetchImpl(this.config.proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.authToken}` },
      body: JSON.stringify({ ...proxyRequest, orgId: this.config.orgId }),
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the proxy's own response shape is validated field-by-field below, not trusted as typed JSON.
    const body: LlmProxyHttpResponse = await res.json();
    if (!res.ok || body.status !== 'ok') {
      throw new Error(`llm-proxy call failed (${String(res.status)}): ${body.message ?? 'no message'}`);
    }
    return finalizeResponse({
      text: body.text ?? '',
      stopReason: body.stopReason ?? 'end_turn',
      inputTokens: body.inputTokens ?? 0,
      outputTokens: body.outputTokens ?? 0,
      cacheReadTokens: body.cacheReadTokens ?? 0,
    });
  }
}

export interface DirectLlmClientConfig {
  apiKey: string;
  model?: string;
}

/** §3.5: "`@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`. Used when no proxy is configured and by the live evaluation run (§12.6)." Never constructed from the browser (K-10: "the browser never holds a key") — only from a server context (`scripts/scoreCapture.ts --live`, or `capture-run` when `LLM_PROXY_URL` isn't set). */
export class DirectLlmClient implements LlmClient {
  constructor(private readonly config: DirectLlmClientConfig) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    // Imported lazily so a browser bundle that never constructs this class
    // never pulls the SDK in — `src/capture/llm/client.ts` is imported by
    // `capture-run` (Deno) too, per K-15, and this class is simply never
    // instantiated there.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const model = request.model ?? this.config.model ?? DEFAULT_CAPTURE_MODEL;
    const stream = client.messages.stream({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_CAPTURE_MAX_TOKENS,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: { effort: request.effort, format: { type: 'json_schema', schema: request.format.schema } },
    });
    const message = await stream.finalMessage();

    const textBlock = message.content.find((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text');
    if (!textBlock && message.stop_reason !== 'refusal' && message.stop_reason !== 'max_tokens') {
      throw new LlmSchemaInvalidError('DirectLlmClient: no text content block in a response that neither refused nor truncated.');
    }
    return finalizeResponse({
      text: textBlock?.text ?? '',
      stopReason: message.stop_reason ?? 'end_turn',
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    });
  }
}

/** Deterministic (rule 6), non-cryptographic FNV-1a over a canonicalised JSON string — a cassette cache key, not a security boundary. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Sorts object keys recursively so property-insertion order never changes the hash — the request objects built by `src/capture/prompts/*` are always freshly-constructed literals, and JS gives no ordering guarantee across call sites. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

/** Keys a cassette by the request's own content, per §12.1 ("keyed by request hash"). Exported so fixtures/tooling (PR10+) can compute the same key a `RecordedLlmClient` would look up, without constructing the client itself. */
export function hashLlmRequest(request: LlmRequest): string {
  return fnv1aHex(JSON.stringify(canonicalize({ model: request.model ?? DEFAULT_CAPTURE_MODEL, maxTokens: request.maxTokens ?? DEFAULT_CAPTURE_MAX_TOKENS, effort: request.effort, system: request.system, format: request.format, messages: request.messages })));
}

export interface RecordedLlmCassette {
  text: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface RecordedLlmClientConfig {
  cassettes: ReadonlyMap<string, RecordedLlmCassette>;
}

/** §3.5/§12.1: "replays `fixtures/**\/llm/*.json` keyed by a hash of the request body; throws on a miss." A test double for the network only (CLAUDE.md rule 7) — the extraction/grounding/matching code downstream of `LlmClient` is identical whichever implementation supplies the response. The fixture-file loading itself belongs to the fixture harness (PR10); this class only replays whatever cassette map it's given. */
export class RecordedLlmClient implements LlmClient {
  constructor(private readonly config: RecordedLlmClientConfig) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- deliberately async (not just Promise-returning) so a synchronous throw below rejects the returned promise instead of throwing out of the call itself, matching every other LlmClient implementation's calling convention.
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const key = hashLlmRequest(request);
    const cassette = this.config.cassettes.get(key);
    if (!cassette) {
      throw new Error(`RecordedLlmClient: no cassette for request hash "${key}" (model=${request.model ?? DEFAULT_CAPTURE_MODEL}, effort=${request.effort}). Record one or check the request hasn't drifted from what was recorded.`);
    }
    return finalizeResponse(cassette);
  }
}
