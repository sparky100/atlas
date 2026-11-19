/**
 * Phase D step 1: save or remove an organisation's own AI key (for agents).
 * A thin transport shim: every decision lives in `src/tools/orgAiKeyHandler.ts`,
 * tested with Vitest.
 *
 * The caller's own session proves they are an owner of the organisation
 * (row-level security on `members` decides what they can see). Only then is
 * the service-role client used, and only to call the three service-only
 * database functions that keep the key in Vault. The key is never logged,
 * returned or put into an error message.
 *
 * **Hand-authored source, not what is deployed**: `pnpm functions:bundle:org-ai-key`
 * bundles this plus its `src/` imports into the generated, git-ignored
 * `supabase/functions/org-ai-key/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { handleOrgAiKey } from '../../../../src/tools/orgAiKeyHandler.ts';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !serviceKey) {
    return jsonResponse({ status: 'error', message: 'This function is not configured.' }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const asCaller = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const outcome = await handleOrgAiKey(
      {
        isOwner: async (orgId) => {
          const { data: userData, error: userError } = await asCaller.auth.getUser();
          if (userError || !userData.user) return false;
          const { data, error } = await asCaller.from('members').select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
          if (error) return false;
          return (data as { role?: string } | null)?.role === 'owner';
        },
        setKey: async (orgId, key) => {
          const { error } = await service.schema('atlas').rpc('set_org_ai_key', { p_org: orgId, p_key: key });
          if (error) throw new Error('Could not save the key.');
        },
        clearKey: async (orgId) => {
          const { error } = await service.schema('atlas').rpc('clear_org_ai_key', { p_org: orgId });
          if (error) throw new Error('Could not remove the key.');
        },
      },
      body,
    );
    if (outcome.status === 'invalid') return jsonResponse(outcome, 400);
    if (outcome.status === 'forbidden') return jsonResponse(outcome, 403);
    return jsonResponse(outcome, 200);
  } catch (e) {
    // Only our own fixed sentences reach here, never the key or a provider/database message.
    console.error('org-ai-key: failed', e instanceof Error ? e.message : 'unknown');
    return jsonResponse({ status: 'error', message: 'Something went wrong. Try again.' }, 500);
  }
});
