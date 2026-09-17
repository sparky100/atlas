/**
 * E4 (docs/prompts/atlas-prompt-pack.md), ADR-014: the wire contract for
 * `supabase/functions/llm-proxy` — pure, no I/O, same split `comments.ts`
 * already draws (row shapes for `llm_proxy_requests` live in
 * `src/db/types.ts`, not here; this is what's sent/received over HTTP).
 * Ported from the existing suite's own `src/llm/contracts.js`
 * (`buildLlmRequest`), narrowed to what Atlas's own capture pipeline
 * (SPEC-capture.md K-10) actually needs: no `kind`/task taxonomy (that's
 * Lens-specific prompt routing), no `stream` (capture is a background job,
 * not an interactive chat UI — the edge function always returns a
 * complete response). The response shape is deliberately a reduced view of
 * whatever the underlying provider returns, not a passthrough of
 * Anthropic's own Messages API JSON — provider auth is one of the things
 * ADR-014 names as worth abstracting away, so a caller reading `.text`
 * never needs to change if the provider behind this proxy ever does.
 *
 * The edge function itself (Deno, a separate runtime this file can't be
 * imported into — same limitation `send-invite-email/index.ts`'s own
 * module comment notes) re-validates the identical shape independently;
 * keep the two in sync by hand.
 */

export const LLM_PROXY_CONTRACT_VERSION = '2026-09-17';

export type LlmProxyMessageRole = 'system' | 'user' | 'assistant';

export interface LlmProxyMessage {
  role: LlmProxyMessageRole;
  content: string;
}

export type LlmProxyResponseFormat = 'text' | 'json';

export interface LlmProxyRequest {
  version: string;
  messages: LlmProxyMessage[];
  maxTokens: number;
  responseFormat: LlmProxyResponseFormat;
}

export interface LlmProxyResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const MAX_TOKENS_CEILING = 16000;
const DEFAULT_MAX_TOKENS = 1024;

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
}

/** Builds a well-formed `LlmProxyRequest` from loose input — the one place normalization happens, so every caller and this file's own round-trip test agree on the same rules. */
export function buildLlmProxyRequest(input: BuildLlmProxyRequestInput): LlmProxyRequest {
  const messages = normalizeMessages(input.messages);
  const maxTokens = Math.min(Math.max(Math.trunc(input.maxTokens ?? DEFAULT_MAX_TOKENS), 1), MAX_TOKENS_CEILING);
  const responseFormat: LlmProxyResponseFormat = input.responseFormat === 'json' ? 'json' : 'text';
  return { version: LLM_PROXY_CONTRACT_VERSION, messages, maxTokens, responseFormat };
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
  return true;
}
