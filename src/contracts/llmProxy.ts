/**
 * E4 (docs/prompts/atlas-prompt-pack.md), ADR-014: the wire contract for
 * `supabase/functions/llm-proxy` — pure, no I/O, same split `comments.ts`
 * already draws (row shapes for `llm_proxy_requests` live in
 * `src/db/types.ts`, not here; this is what's sent/received over HTTP).
 * Ported from the existing suite's own `src/llm/contracts.js`
 * (`buildLlmRequest`), narrowed to what Atlas's own capture pipeline
 * (SPEC-capture.md K-10) actually needs: no `kind`/task taxonomy (that's
 * Lens-specific prompt routing). The response shape is deliberately a
 * reduced view of whatever the underlying provider returns, not a
 * passthrough of Anthropic's own Messages API JSON — provider auth is one
 * of the things ADR-014 names as worth abstracting away, so a caller
 * reading `.text` never needs to change if the provider behind this proxy
 * ever does.
 *
 * F2 (full K1) extension, SPEC-capture.md §3.5/§6 (K-10): capture needs
 * structured outputs, per-call effort, a cached system prefix, and the
 * provider's own stop reason — none of which the original E4 shape carried.
 * All four are additive optional fields; `LLM_PROXY_CONTRACT_VERSION` is
 * bumped so a cassette or log row can tell which shape produced it, but
 * every existing caller (`send-invite-email` included) that never sets
 * `outputConfig`/`cacheControl`/`stream` keeps getting exactly the response
 * it always did. `stream` still never turns the edge function's own HTTP
 * response into `text/event-stream` (this proxy calls a background job, not
 * an interactive chat UI) — it only asks the proxy to stream *from* the
 * provider internally, so a long prose-extraction generation doesn't sit on
 * one buffered response long enough to time out, and still hand back one
 * complete JSON body.
 *
 * The edge function itself (Deno, a separate runtime this file can't be
 * imported into — same limitation `send-invite-email/index.ts`'s own
 * module comment notes) re-validates the identical shape independently;
 * keep the two in sync by hand.
 */

export const LLM_PROXY_CONTRACT_VERSION = '2026-11-06';

export type LlmProxyMessageRole = 'system' | 'user' | 'assistant';

/**
 * Additive, ADR-028 §3 (Ask Atlas): a message's content may be a list of
 * blocks instead of a string, so a conversation can carry the provider's
 * tool calls and their results. A plain string stays exactly as it was.
 */
export type LlmProxyContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LlmProxyMessage {
  role: LlmProxyMessageRole;
  content: string | LlmProxyContentBlock[];
}

/** Additive, ADR-028 §3: one tool the model may call. `inputSchema` is a JSON Schema object. */
export interface LlmProxyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Additive, ADR-028 §3: a tool call the model asked for. */
export interface LlmProxyToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmProxyResponseFormat = 'text' | 'json';

/** Matches the provider's own `output_config.effort` values (SPEC-capture.md §6: prompt A/C `medium`, prompt B `high`). */
export type LlmProxyEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmProxyJsonSchemaFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

/** Structured-output request, §6: "Structured outputs... replace any instruction to reply in JSON; there is no assistant prefill." */
export interface LlmProxyOutputConfig {
  effort: LlmProxyEffort;
  format: LlmProxyJsonSchemaFormat;
}

export interface LlmProxyRequest {
  version: string;
  messages: LlmProxyMessage[];
  maxTokens: number;
  responseFormat: LlmProxyResponseFormat;
  /** Additive, K-10: when present, the proxy asks the provider for schema-constrained JSON via `output_config` instead of relying on `responseFormat: 'json'`'s own free-form hint. Omitted by every caller that predates this field. */
  outputConfig?: LlmProxyOutputConfig;
  /** Additive, K-10: marks the joined system-role content as a stable, cacheable prefix (`cache_control: { type: 'ephemeral' }`) — set when the caller's system content doesn't vary between calls, e.g. capture's own frozen prompts (§6.4: "no timestamps, job ids or user names inside the system block"). */
  cacheControl?: boolean;
  /** Additive, K-10: ask the proxy to stream the generation from the provider internally (§3.5: "streaming for the prose-extraction call") — never changes the shape of this call's own response, which is always one complete JSON body. */
  stream?: boolean;
  /**
   * Additive, in-app help (ported from Des-Studio's `llm-proxy`, which
   * genuinely forwards `text/event-stream` to the browser — unlike the rest
   * of this proxy, whose `stream` field above only ever asks for internal
   * provider-side streaming behind one buffered JSON response). Set only by
   * the help chat (`src/ui/help/streamHelpAnswer.ts`), never by capture:
   * when true, the edge function's own HTTP response to *this* caller is
   * `text/event-stream`, forwarding the provider's raw SSE bytes as they
   * arrive so an answer can type out live, and it still logs one
   * `llm_proxy_requests` row once the stream ends. Requires `stream: true`
   * (there is no buffered variant of a passthrough) and `responseFormat:
   * 'text'` with no `outputConfig` (structured JSON isn't meaningfully
   * streamable token-by-token to a chat UI) — `isValidLlmProxyRequest`
   * enforces both.
   */
  streamToClient?: boolean;
  /** Additive, ADR-028 §3: tools the model may call. Any conversation that contains tool blocks must also send `tools` (the provider requires it). */
  tools?: LlmProxyToolDefinition[];
  /** Additive, ADR-028 §3: `'none'` keeps the tools declared but forbids calling one — used for the final, written-answer round. Default `'auto'`. */
  toolChoice?: 'auto' | 'none';
}

export interface LlmProxyResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Additive, K-10: the provider's own stop reason (`end_turn`, `max_tokens`,
   * `refusal`, ...). §3.5: "`stop_reason` is checked before `content` is
   * read: `refusal` and `max_tokens` are failure modes (§11), never parsed
   * as partial output" — that check is the caller's (`src/capture/llm/client.ts`),
   * this field only carries the value through. Absent for a provider call
   * that predates this field or reports none.
   */
  stopReason?: string;
  /** Additive, K-10: tokens served from the prompt cache, when `cacheControl` was set and the provider reports it. */
  cacheReadTokens?: number;
  /** Additive, ADR-028 §3: the tool calls the model asked for, in order. Absent when it asked for none; `stopReason` is `tool_use` when present. */
  toolCalls?: LlmProxyToolCall[];
}

const MAX_TOKENS_CEILING = 16000;
const DEFAULT_MAX_TOKENS = 1024;
const VALID_EFFORTS: readonly LlmProxyEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface LooseMessage {
  role?: unknown;
  content?: unknown;
}

/** Same three-role collapse Des-Studio's own `contracts.js`/`llm-proxy/index.ts` use ("assistant-confirm" folds into "assistant"; anything else that isn't "system" is "user") — an empty-after-trim message is dropped rather than sent to the provider as a blank turn. */
function normalizeRole(role: unknown): LlmProxyMessageRole {
  if (role === 'assistant' || role === 'assistant-confirm') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps a block only if it is exactly one of the three known shapes; anything else is dropped rather than sent upstream as garbage. */
export function normalizeContentBlock(raw: unknown): LlmProxyContentBlock | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'text' && typeof raw.text === 'string') return raw.text.trim() === '' ? null : { type: 'text', text: raw.text };
  if (raw.type === 'tool_use' && typeof raw.id === 'string' && typeof raw.name === 'string' && isRecord(raw.input)) return { type: 'tool_use', id: raw.id, name: raw.name, input: raw.input };
  if (raw.type === 'tool_result' && typeof raw.toolUseId === 'string' && typeof raw.content === 'string') {
    return { type: 'tool_result', toolUseId: raw.toolUseId, content: raw.content, ...(raw.isError === true ? { isError: true } : {}) };
  }
  return null;
}

function normalizeContent(content: unknown): string | LlmProxyContentBlock[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks: LlmProxyContentBlock[] = [];
  for (const raw of content) {
    const block = normalizeContentBlock(raw);
    if (block) blocks.push(block);
  }
  return blocks;
}

function isBlankContent(content: string | LlmProxyContentBlock[]): boolean {
  return typeof content === 'string' ? content.trim() === '' : content.length === 0;
}

function normalizeMessages(messages: readonly LooseMessage[]): LlmProxyMessage[] {
  return messages.map((m) => ({ role: normalizeRole(m.role), content: normalizeContent(m.content) })).filter((m) => !isBlankContent(m.content));
}

/** Same shape check the edge function repeats by hand: a tool needs a name, a description and an object schema. */
export function normalizeTools(raw: unknown): LlmProxyToolDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tools: LlmProxyToolDefinition[] = [];
  for (const t of raw) {
    if (isRecord(t) && typeof t.name === 'string' && t.name !== '' && typeof t.description === 'string' && isRecord(t.inputSchema)) {
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
    }
  }
  return tools.length > 0 ? tools : undefined;
}

export interface BuildLlmProxyRequestInput {
  messages: readonly LooseMessage[];
  maxTokens?: number;
  responseFormat?: LlmProxyResponseFormat;
  outputConfig?: LlmProxyOutputConfig;
  cacheControl?: boolean;
  stream?: boolean;
  /** Additive, in-app help — see `LlmProxyRequest.streamToClient`'s own comment. Setting this forces `stream: true` regardless of the `stream` input, since a passthrough with no provider-side stream to forward makes no sense. */
  streamToClient?: boolean;
  tools?: readonly LooseTool[];
  toolChoice?: 'auto' | 'none';
}

type LooseTool = LlmProxyToolDefinition;

/** Builds a well-formed `LlmProxyRequest` from loose input — the one place normalization happens, so every caller and this file's own round-trip test agree on the same rules. */
export function buildLlmProxyRequest(input: BuildLlmProxyRequestInput): LlmProxyRequest {
  const messages = normalizeMessages(input.messages);
  const maxTokens = Math.min(Math.max(Math.trunc(input.maxTokens ?? DEFAULT_MAX_TOKENS), 1), MAX_TOKENS_CEILING);
  const responseFormat: LlmProxyResponseFormat = input.responseFormat === 'json' ? 'json' : 'text';
  const tools = normalizeTools(input.tools);
  return {
    version: LLM_PROXY_CONTRACT_VERSION,
    messages,
    maxTokens,
    responseFormat,
    ...(input.outputConfig ? { outputConfig: input.outputConfig } : {}),
    ...(input.cacheControl ? { cacheControl: true } : {}),
    ...(input.stream || input.streamToClient ? { stream: true } : {}),
    ...(input.streamToClient ? { streamToClient: true } : {}),
    ...(tools ? { tools } : {}),
    ...(tools && input.toolChoice === 'none' ? { toolChoice: 'none' as const } : {}),
  };
}

function isValidOutputConfig(value: unknown): value is LlmProxyOutputConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.effort !== 'string' || !VALID_EFFORTS.includes(v.effort as LlmProxyEffort)) return false;
  if (typeof v.format !== 'object' || v.format === null) return false;
  const format = v.format as Record<string, unknown>;
  return format.type === 'json_schema' && typeof format.schema === 'object' && format.schema !== null;
}

function isValidContent(content: unknown): boolean {
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.every((b) => normalizeContentBlock(b) !== null);
}

/** True for anything `buildLlmProxyRequest` could have produced — used by the edge function's own request validation and by this file's own round-trip test, never by a caller to skip building through `buildLlmProxyRequest` in the first place. */
export function isValidLlmProxyRequest(value: unknown): value is LlmProxyRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'string') return false;
  if (!Array.isArray(v.messages) || v.messages.length === 0) return false;
  if (
    !v.messages.every(
      (m) => typeof m === 'object' && m !== null && ['system', 'user', 'assistant'].includes((m as Record<string, unknown>).role as string) && isValidContent((m as Record<string, unknown>).content),
    )
  ) {
    return false;
  }
  if (typeof v.maxTokens !== 'number' || v.maxTokens < 1 || v.maxTokens > MAX_TOKENS_CEILING) return false;
  if (v.responseFormat !== 'text' && v.responseFormat !== 'json') return false;
  if (v.outputConfig !== undefined && !isValidOutputConfig(v.outputConfig)) return false;
  if (v.cacheControl !== undefined && typeof v.cacheControl !== 'boolean') return false;
  if (v.stream !== undefined && typeof v.stream !== 'boolean') return false;
  if (v.streamToClient !== undefined) {
    if (typeof v.streamToClient !== 'boolean') return false;
    if (v.streamToClient && (v.stream !== true || v.responseFormat !== 'text' || v.outputConfig !== undefined)) return false;
  }
  if (v.tools !== undefined && (!Array.isArray(v.tools) || v.tools.length === 0 || normalizeTools(v.tools)?.length !== v.tools.length)) return false;
  if (v.toolChoice !== undefined && v.toolChoice !== 'auto' && v.toolChoice !== 'none') return false;
  if (v.toolChoice !== undefined && v.tools === undefined) return false;
  if (v.tools !== undefined && v.outputConfig !== undefined) return false;
  // A passthrough stream cannot hand tool calls back, so it may only carry tools with calling switched off.
  if (v.streamToClient === true && v.tools !== undefined && v.toolChoice !== 'none') return false;
  return true;
}
