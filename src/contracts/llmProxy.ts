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

export const LLM_PROXY_CONTRACT_VERSION = '2026-09-20';

export type LlmProxyMessageRole = 'system' | 'user' | 'assistant';

export interface LlmProxyMessage {
  role: LlmProxyMessageRole;
  content: string;
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

function normalizeMessages(messages: readonly LooseMessage[]): LlmProxyMessage[] {
  return messages
    .map((m) => ({
      role: normalizeRole(m.role),
      content: typeof m.content === 'string' ? m.content : '',
    }))
    .filter((m) => m.content.trim() !== '');
}

export interface BuildLlmProxyRequestInput {
  messages: readonly LooseMessage[];
  maxTokens?: number;
  responseFormat?: LlmProxyResponseFormat;
  outputConfig?: LlmProxyOutputConfig;
  cacheControl?: boolean;
  stream?: boolean;
}

/** Builds a well-formed `LlmProxyRequest` from loose input — the one place normalization happens, so every caller and this file's own round-trip test agree on the same rules. */
export function buildLlmProxyRequest(input: BuildLlmProxyRequestInput): LlmProxyRequest {
  const messages = normalizeMessages(input.messages);
  const maxTokens = Math.min(Math.max(Math.trunc(input.maxTokens ?? DEFAULT_MAX_TOKENS), 1), MAX_TOKENS_CEILING);
  const responseFormat: LlmProxyResponseFormat = input.responseFormat === 'json' ? 'json' : 'text';
  return {
    version: LLM_PROXY_CONTRACT_VERSION,
    messages,
    maxTokens,
    responseFormat,
    ...(input.outputConfig ? { outputConfig: input.outputConfig } : {}),
    ...(input.cacheControl ? { cacheControl: true } : {}),
    ...(input.stream ? { stream: true } : {}),
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

/** True for anything `buildLlmProxyRequest` could have produced — used by the edge function's own request validation and by this file's own round-trip test, never by a caller to skip building through `buildLlmProxyRequest` in the first place. */
export function isValidLlmProxyRequest(value: unknown): value is LlmProxyRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'string') return false;
  if (!Array.isArray(v.messages) || v.messages.length === 0) return false;
  if (
    !v.messages.every(
      (m) => typeof m === 'object' && m !== null && ['system', 'user', 'assistant'].includes((m as Record<string, unknown>).role as string) && typeof (m as Record<string, unknown>).content === 'string',
    )
  ) {
    return false;
  }
  if (typeof v.maxTokens !== 'number' || v.maxTokens < 1 || v.maxTokens > MAX_TOKENS_CEILING) return false;
  if (v.responseFormat !== 'text' && v.responseFormat !== 'json') return false;
  if (v.outputConfig !== undefined && !isValidOutputConfig(v.outputConfig)) return false;
  if (v.cacheControl !== undefined && typeof v.cacheControl !== 'boolean') return false;
  if (v.stream !== undefined && typeof v.stream !== 'boolean') return false;
  return true;
}
