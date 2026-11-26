/**
 * Catalogue step 5b-1: checks whether product claims still match the pages
 * they cite. A platform admin sends up to 5 claims; each cited page is read
 * (public https only, same rules as the link check) and the platform's AI is
 * asked, from the page text alone, whether the claim still stands. The AI must
 * quote a sentence from the page and the quote is verified here before
 * "supported" or "changed" is returned. This function writes nothing: the
 * browser saves the results with the admin's own session.
 *
 * It confirms the caller is a platform admin with the caller's own session. The
 * service role is used only to read the platform AI key (Vault, via
 * `atlas.platform_llm_api_key`, as `llm-proxy` does) and the day's token total
 * from saved results, to enforce the daily limit. It never writes catalogue data.
 *
 * **Hand-authored source, not what is deployed**: `pnpm
 * functions:bundle:catalogue-claim-check` bundles this plus its `src/` imports
 * into the generated, git-ignored `supabase/functions/catalogue-claim-check/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import {
  CLAIM_CHECK_DAILY_TOKEN_LIMIT, CLAIM_CHECK_DEFAULT_MODEL, checkClaim, claimCheckRequestSchema,
  type ClaimCheckDeps, type ClaimCheckResult, type PageResponse,
} from '../../../../src/tools/catalogueClaimCheck.ts';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

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

/** Tokens the catalogue checks have used since midnight UTC, from the saved results. */
async function tokensUsedToday(supabaseUrl: string, serviceRoleKey: string): Promise<number | null> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/catalogue_claim_checks?select=input_tokens,output_tokens&checked_at=gte.${encodeURIComponent(midnight.toISOString())}&limit=20000`, {
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
  const parsed = claimCheckRequestSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ status: 'error', message: 'Send between 1 and 5 claims.' }, 400);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ status: 'error', message: 'Sign in again to check claims.' }, 401);
    // platform_admins' own select policy lets a caller see only their own row: this is "I am a platform admin".
    const { data: admin, error: adminError } = await supabase.from('platform_admins').select('user_id').maybeSingle();
    if (adminError) return jsonResponse({ status: 'error', message: 'Could not confirm admin access.' }, 500);
    if (!admin) return jsonResponse({ status: 'error', message: 'Only platform admins can check claims.' }, 403);

    const apiKey = await loadPlatformKey(supabaseUrl, serviceRoleKey);
    if (apiKey === '') return jsonResponse({ status: 'error', code: 'not_configured', message: 'The claim checker is not available: no platform AI key is set.' }, 503);
    const used = await tokensUsedToday(supabaseUrl, serviceRoleKey);
    if (used === null) return jsonResponse({ status: 'error', message: "Could not read today's AI use, so no claims were checked." }, 500);
    if (used >= CLAIM_CHECK_DAILY_TOKEN_LIMIT) {
      return jsonResponse({ status: 'error', code: 'daily_limit', message: 'The daily AI limit for catalogue checks has been reached. Results so far are saved. Try again tomorrow.' }, 429);
    }

    const model = Deno.env.get('CATALOGUE_CHECK_MODEL') || CLAIM_CHECK_DEFAULT_MODEL;
    const deps: ClaimCheckDeps = {
      model,
      resolve: resolveHost,
      getPage,
      askModel: async (system, user) => {
        const res = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
          body: JSON.stringify({ model, max_tokens: 300, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
        });
        if (!res.ok) throw new Error(`provider ${String(res.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
        const json = await res.json();
        const data = json as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
        const text = (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
        return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
      },
    };

    const results: ClaimCheckResult[] = await Promise.all(parsed.data.claims.map((claim) => checkClaim(claim, deps)));
    return jsonResponse({ status: 'ok', results }, 200);
  } catch {
    return jsonResponse({ status: 'error', message: 'The claim check failed.' }, 500);
  }
});
