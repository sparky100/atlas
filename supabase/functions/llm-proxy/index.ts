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
 * - **No streaming.** Capture is a background job, not an interactive chat
 *   UI (`src/contracts/llmProxy.ts`'s own module comment) — the response
 *   is always the complete text, never `text/event-stream`.
 * - **No audio transcription, no URL-fetch/readability extraction.** Both
 *   exist in Des-Studio's own version but are Lens-specific product
 *   features (an SSRF-guarded URL importer, Whisper/Deepgram voice notes),
 *   not "AI-assisted capture" in ADR-014's sense — out of scope here.
 * - **No `apiKeyPreview` on the status endpoint.** Des-Studio's own GET
 *   handler echoes the first 12 characters of the configured API key back
 *   to any caller who can reach it — not repeated here.
 *
 * `orgId` is required on every call (there is no single-tenant
 * `platform_config` row the way Des-Studio has — Atlas is genuinely
 * multi-org, ADR-017): the caller's own forwarded session must be a real
 * member of that org (`members_select`'s RLS is the actual authorization
 * check, re-derived here exactly like every other edge function/RPC in
 * this codebase, never trusted from the request body). Every call — 'ok',
 * 'error', or 'rate_limited' — is logged to `llm_proxy_requests`
 * (org, model, token counts, latency, status; never the prompt or
 * response content itself) via the service-role key, which this function
 * holds unlike `send-invite-email` (see that function's own module
 * comment) specifically because nothing in this schema lets an ordinary
 * member insert their own audit rows — the per-org rate limit is simply a
 * count of that same table's own rows in the last hour, so there is
 * nothing else to keep in sync.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_RATE_LIMIT_PER_HOUR = 100;
const MAX_TOKENS_CEILING = 16000;
const DEFAULT_MAX_TOKENS = 1024;

type Role = 'system' | 'user' | 'assistant';
interface ProxyMessage {
  role: Role;
  content: string;
}
interface ProxyRequestBody {
  messages: ProxyMessage[];
  maxTokens: number;
  responseFormat: 'text' | 'json';
}

/** Same three-role collapse `src/contracts/llmProxy.ts`'s own `normalizeRole` uses — kept in sync by hand across the runtime boundary (see that file's own module comment). */
function normalizeRole(role: unknown): Role {
  if (role === 'assistant' || role === 'assistant-confirm') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

function normalizeRequest(raw: unknown): ProxyRequestBody | Response {
  if (typeof raw !== 'object' || raw === null) {
    return jsonResponse({ status: 'error', message: 'A request body is required.' }, 400);
  }
  const r = raw as Record<string, unknown>;
  const rawMessages = Array.isArray(r.messages) ? r.messages : [];
  const messages: ProxyMessage[] = rawMessages
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({ role: normalizeRole(m.role), content: typeof m.content === 'string' ? m.content : '' }))
    .filter((m) => m.content.trim() !== '');
  if (messages.length === 0) {
    return jsonResponse({ status: 'error', message: 'At least one non-empty message is required.' }, 400);
  }
  const maxTokens = Math.min(Math.max(Math.trunc(Number(r.maxTokens) || DEFAULT_MAX_TOKENS), 1), MAX_TOKENS_CEILING);
  const responseFormat = r.responseFormat === 'json' ? 'json' : 'text';
  return { messages, maxTokens, responseFormat };
}

interface AnthropicCallResult {
  ok: boolean;
  status: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callAnthropic(request: ProxyRequestBody, apiKey: string, model: string): Promise<AnthropicCallResult> {
  const systemText = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const userMessages = request.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const upstream = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify({ model, system: systemText || undefined, messages: userMessages, max_tokens: request.maxTokens }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return { ok: false, status: upstream.status, text: `Upstream ${String(upstream.status)}: ${detail || 'no body'}`, inputTokens: 0, outputTokens: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const data = await upstream.json();
  const contentBlocks: { type?: string; text?: string }[] = Array.isArray(data.content) ? data.content : [];
  const text = contentBlocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  const inputTokens = typeof data.usage?.input_tokens === 'number' ? data.usage.input_tokens : 0;
  const outputTokens = typeof data.usage?.output_tokens === 'number' ? data.usage.output_tokens : 0;
  return { ok: true, status: upstream.status, text, inputTokens, outputTokens };
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
    // get wrong.
    const { data: membership, error: membershipError } = await callerClient.from('members').select('user_id').eq('org_id', orgId).maybeSingle();
    if (membershipError) return jsonResponse({ status: 'error', message: `Could not verify membership: ${membershipError.message}` }, 500);
    if (!membership) return jsonResponse({ status: 'error', message: 'Not a member of this organisation.' }, 403);

    const proxyRequest = normalizeRequest(body);
    if (proxyRequest instanceof Response) return proxyRequest;

    const model = Deno.env.get('LLM_PROXY_MODEL') || DEFAULT_MODEL;
    const rateLimitPerHour = Number(Deno.env.get('LLM_PROXY_RATE_LIMIT_PER_HOUR')) || DEFAULT_RATE_LIMIT_PER_HOUR;
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

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      await logRequest({ serviceClient, orgId, model, status: 'error', latencyMs: Date.now() - startedAt });
      return jsonResponse({ status: 'error', message: 'LLM proxy is not configured for this project — ANTHROPIC_API_KEY is not set. See docs/EDGE-FUNCTIONS.md.' }, 503);
    }

    const result = await callAnthropic(proxyRequest, apiKey, model);
    const latencyMs = Date.now() - startedAt;

    if (!result.ok) {
      await logRequest({ serviceClient, orgId, model, status: 'error', latencyMs });
      return jsonResponse({ status: 'error', message: result.text }, result.status);
    }

    await logRequest({ serviceClient, orgId, model, status: 'ok', latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return jsonResponse({ status: 'ok', text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens }, 200);
  } catch (e) {
    return jsonResponse({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error calling the LLM proxy.' }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
