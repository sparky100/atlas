/**
 * Catalogue step 5a: checks whether claim source links still work. A platform
 * admin sends up to 25 links; each is requested once (no page body is read) and
 * the result is returned. This function writes nothing: the browser saves the
 * results with the admin's own session, so the service key is never involved.
 *
 * It uses only the caller's session, to confirm they are a platform admin. The
 * safety rules (https only, standard port, no local or private addresses, also
 * after redirects, three redirects at most) live in `src/tools/catalogueLinkCheck.ts`.
 *
 * **Hand-authored source, not what is deployed**: `pnpm
 * functions:bundle:catalogue-link-check` bundles this plus its `src/` imports
 * into the generated, git-ignored `supabase/functions/catalogue-link-check/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { checkLink, distinctUrls, linkCheckRequestSchema, type LinkCheckDeps, type LinkCheckResult } from '../../../../src/tools/catalogueLinkCheck.ts';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

const deps: LinkCheckDeps = {
  resolve: async (host) => {
    const [v4, v6] = await Promise.all([
      Deno.resolveDns(host, 'A').catch(() => [] as string[]),
      Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
    ]);
    return [...v4, ...v6];
  },
  request: async (url, method, signal) => {
    // No cookies, no credentials, no referrer, no automatic redirects: each hop is checked by the caller.
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'user-agent': 'AtlasCatalogueLinkCheck/1.0 (checks that cited pages still exist)', accept: '*/*' },
    });
    return { status: response.status, location: response.headers.get('location'), discard: () => { void response.body?.cancel().catch(() => undefined); } };
  },
};

/** Check links a few at a time, keeping the order of the request. */
async function checkAll(urls: string[]): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = new Array<LinkCheckResult>(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const index = next;
      next += 1;
      results[index] = await checkLink(urls[index] ?? '', deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, urls.length) }, worker));
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) return jsonResponse({ status: 'error', message: 'This function is not configured.' }, 500);

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400); }
  const parsed = linkCheckRequestSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ status: 'error', message: 'Send between 1 and 25 links.' }, 400);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ status: 'error', message: 'Sign in again to check links.' }, 401);
    // platform_admins' own select policy lets a caller see only their own row: this is "I am a platform admin".
    const { data: admin, error: adminError } = await supabase.from('platform_admins').select('user_id').maybeSingle();
    if (adminError) return jsonResponse({ status: 'error', message: 'Could not confirm admin access.' }, 500);
    if (!admin) return jsonResponse({ status: 'error', message: 'Only platform admins can check links.' }, 403);

    const results = await checkAll(distinctUrls(parsed.data.urls));
    return jsonResponse({ status: 'ok', results }, 200);
  } catch {
    return jsonResponse({ status: 'error', message: 'The link check failed.' }, 500);
  }
});
