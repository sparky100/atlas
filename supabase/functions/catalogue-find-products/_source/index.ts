/**
 * Catalogue step 6a: finds new products for one capability. A platform admin
 * sends the capability's name and definition and the sector; the platform's AI
 * searches the public web (the provider's web search tool, at most 5 searches)
 * and proposes products, each with claims quoting a page. Every cited page is
 * then read here (public https only) and a claim is kept only if its sentence is
 * really on the page. This function writes nothing: the browser checks the
 * library and saves new products as drafts with the admin's own session.
 *
 * Sent to the provider: the capability name and definition, the sector and the
 * word "product". Never organisation data.
 *
 * It confirms the caller is a platform admin with the caller's own session. The
 * service role reads only the platform AI key (Vault) and the day's discovery
 * tokens from the run record.
 *
 * **Hand-authored source, not what is deployed**: `pnpm
 * functions:bundle:catalogue-find-products` bundles this plus its `src/` imports
 * into the generated, git-ignored `supabase/functions/catalogue-find-products/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import type { PageResponse } from '../../../../src/tools/catalogueClaimCheck.ts';
import {
  FIND_DAILY_TOKEN_LIMIT, FIND_DEFAULT_MODEL, FIND_MAX_COMPONENTS, FIND_MAX_COMPONENT_SEARCHES, FIND_MAX_SEARCHES, FIND_SYSTEM, FIND_WEB_SEARCH_TOOL,
  FIND_COMPONENTS_SYSTEM, asComponentsOf, findComponentsRequestSchema, findComponentsUserMessage, findRequestSchema, findUserMessage, keepComponents, parseFindAnswer, verifyCandidates,
} from '../../../../src/tools/catalogueFindProducts.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_CONTINUATIONS = 3;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function resolveHost(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}

async function getPage(url: string, signal: AbortSignal): Promise<PageResponse> {
  // No cookies, no credentials, no referrer, no automatic redirects: each hop is checked by the caller.
  const response = await fetch(url, {
    method: 'GET', redirect: 'manual', signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { 'user-agent': 'AtlasCatalogueClaimCheck/1.0 (checks that cited pages still say what a claim says)', accept: 'text/html,text/plain;q=0.9' },
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    contentType: response.headers.get('content-type') ?? '',
    readText: async (maxBytes) => {
      if (!response.body) return '';
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
      void reader.cancel().catch(() => undefined);
      const merged = new Uint8Array(Math.min(total, maxBytes));
      let offset = 0;
      for (const chunk of chunks) {
        const room = merged.length - offset;
        if (room <= 0) break;
        merged.set(chunk.subarray(0, room), offset);
        offset += Math.min(chunk.byteLength, room);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(merged);
    },
    discard: () => { void response.body?.cancel().catch(() => undefined); },
  };
}

async function loadPlatformKey(supabaseUrl: string, serviceRoleKey: string): Promise<string> {
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

/** Tokens product discovery has used since midnight UTC, from the run record. */
async function tokensUsedToday(supabaseUrl: string, serviceRoleKey: string): Promise<number | null> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/catalogue_check_runs?select=input_tokens,output_tokens&scope=in.(find,find_set)&started_at=gte.${encodeURIComponent(midnight.toISOString())}&limit=5000`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return (rows as { input_tokens: number; output_tokens: number }[]).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
  } catch {
    return null;
  }
}

interface ProviderBlock { type: string; text?: string }
interface ProviderReply {
  content?: ProviderBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
}

class WebSearchOff extends Error {}

/** Ask the model to search and answer, continuing a paused turn a few times. */
async function search(apiKey: string, model: string, system: string, user: string, limits: { searches: number; maxTokens: number } = { searches: FIND_MAX_SEARCHES, maxTokens: 8000 }): Promise<{ text: string; inputTokens: number; outputTokens: number; searches: number }> {
  const messages: { role: string; content: unknown }[] = [{ role: 'user', content: user }];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify({
        model, max_tokens: limits.maxTokens, system, messages,
        tools: [{ type: FIND_WEB_SEARCH_TOOL, name: 'web_search', max_uses: limits.searches }],
        output_config: { effort: 'low' },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).toLowerCase();
      if (res.status !== 429 && res.status < 500 && detail.includes('web search')) throw new WebSearchOff();
      throw new Error(`provider ${String(res.status)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const json = await res.json();
    const reply = json as ProviderReply;
    inputTokens += reply.usage?.input_tokens ?? 0;
    outputTokens += reply.usage?.output_tokens ?? 0;
    searches += reply.usage?.server_tool_use?.web_search_requests ?? 0;
    if (reply.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: reply.content ?? [] });
      continue;
    }
    if (reply.stop_reason === 'refusal') throw new Error('refused');
    const text = (reply.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
    return { text, inputTokens, outputTokens, searches };
  }
  throw new Error('too many continuations');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return jsonResponse({ status: 'error', message: 'This function is not configured.' }, 500);

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400); }
  const parsedCapability = findRequestSchema.safeParse(body);
  const parsedComponents = parsedCapability.success ? null : findComponentsRequestSchema.safeParse(body);
  const capabilityRequest = parsedCapability.success ? parsedCapability.data : null;
  const componentsRequest = parsedComponents?.success === true ? parsedComponents.data : null;
  if (capabilityRequest === null && componentsRequest === null) {
    return jsonResponse({ status: 'error', message: 'Send the capability name, its definition and the sector, or a platform name and its vendor.' }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ status: 'error', message: 'Sign in again to find products.' }, 401);
    const { data: admin, error: adminError } = await supabase.from('platform_admins').select('user_id').maybeSingle();
    if (adminError) return jsonResponse({ status: 'error', message: 'Could not confirm admin access.' }, 500);
    if (!admin) return jsonResponse({ status: 'error', message: 'Only platform admins can find products.' }, 403);

    const apiKey = await loadPlatformKey(supabaseUrl, serviceRoleKey);
    if (apiKey === '') return jsonResponse({ status: 'error', code: 'not_configured', message: 'Finding products is not available: no platform AI key is set.' }, 503);
    const used = await tokensUsedToday(supabaseUrl, serviceRoleKey);
    if (used === null) return jsonResponse({ status: 'error', message: "Could not read today's AI use, so nothing was searched." }, 500);
    if (used >= FIND_DAILY_TOKEN_LIMIT) {
      return jsonResponse({ status: 'error', code: 'daily_limit', message: 'The daily AI limit for finding products has been reached. Try again tomorrow.' }, 429);
    }

    const model = Deno.env.get('CATALOGUE_FIND_MODEL') || FIND_DEFAULT_MODEL;
    let answer: Awaited<ReturnType<typeof search>>;
    try {
      answer = capabilityRequest !== null
        ? await search(apiKey, model, FIND_SYSTEM, findUserMessage(capabilityRequest))
        : await search(apiKey, model, FIND_COMPONENTS_SYSTEM, findComponentsUserMessage(componentsRequest as NonNullable<typeof componentsRequest>), { searches: FIND_MAX_COMPONENT_SEARCHES, maxTokens: 16000 });
    } catch (cause) {
      if (cause instanceof WebSearchOff) return jsonResponse({ status: 'error', code: 'web_search_off', message: 'Web search is not switched on for the platform AI account. Nothing was searched.' }, 503);
      return jsonResponse({ status: 'error', message: 'The AI could not be reached, so no products were found.' }, 502);
    }
    const candidates = parseFindAnswer(answer.text, componentsRequest === null ? undefined : FIND_MAX_COMPONENTS);
    if (candidates === null) {
      return jsonResponse({ status: 'ok', found: [], dropped: [], searches: answer.searches, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, model, note: "The AI's answer could not be read." }, 200);
    }
    const verified = componentsRequest === null
      ? await verifyCandidates(candidates, { resolve: resolveHost, getPage })
      : keepComponents(await verifyCandidates(asComponentsOf(candidates, componentsRequest.platformName), { resolve: resolveHost, getPage }));
    const { found, dropped } = verified;
    return jsonResponse({ status: 'ok', found, dropped, searches: answer.searches, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, model, note: null }, 200);
  } catch {
    return jsonResponse({ status: 'error', message: 'Finding products failed.' }, 500);
  }
});
