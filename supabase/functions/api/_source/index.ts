/**
 * The read-only Atlas API (docs/ADR-031-read-only-api.md). A thin transport
 * shim: every decision lives in `src/api/handler.ts`, tested with Vitest.
 * What is here: build the collaborators and turn the handler's answer into a
 * `Response`.
 *
 * Callers authenticate with an organisation API key, not a Supabase session,
 * so there is no user for row-level security to see. This function therefore
 * holds the service-role key (as `llm-proxy` does) and the scoping is done in
 * code instead: the key is checked and counted by `atlas.api_key_authorize`,
 * models are looked up only among that organisation's own, and every read is
 * of one such model at its main line. Nothing here writes except that
 * authorize call's own usage counter.
 *
 * Deployed with `--no-verify-jwt` (see `[functions.api]` in config.toml): the
 * bearer is an API key, not a JWT.
 *
 * **Hand-authored source, not what is deployed**: `pnpm functions:bundle:api`
 * bundles this plus its `src/` imports into the generated, git-ignored
 * `supabase/functions/api/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { handleApiRequest } from '../../../../src/api/handler.ts';
import { API_RATE_LIMIT_PER_MINUTE } from '../../../../src/contracts/api.ts';
import { createToolContext } from '../../../../src/tools/loadContext.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: { code: 'server_error', message: 'The API is not configured.' } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const url = new URL(req.url);
  // The platform mounts the function at /functions/v1/api; what follows is ours.
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '');

  try {
    const result = await handleApiRequest(
      {
        authorize: async (keyHash) => {
          const { data, error } = await supabase.schema('atlas').rpc('api_key_authorize', { p_key_hash: keyHash, p_limit: API_RATE_LIMIT_PER_MINUTE });
          if (error) throw new Error(`Could not check the key: ${error.message}`);
          const row = (data as { key_id: string; org_id: string; allowed: boolean; retry_after_seconds: number }[] | null)?.[0];
          return row ? { keyId: row.key_id, orgId: row.org_id, allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds } : null;
        },
        listModels: async (orgId) => {
          const { data, error } = await supabase.from('models').select('id, org_id, name, slug, description').eq('org_id', orgId).is('archived_at', null).order('id');
          if (error) throw new Error(`Could not read models: ${error.message}`);
          return (data as { id: string; org_id: string; name: string; slug: string; description: string | null }[]).map((m) => ({ id: m.id, orgId: m.org_id, name: m.name, slug: m.slug, description: m.description }));
        },
        mainCommit: async (modelId) => {
          const { data, error } = await supabase.from('branches').select('head_commit_id').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
          if (error) throw new Error(`Could not read the main line: ${error.message}`);
          return (data as { head_commit_id?: string | null } | null)?.head_commit_id ?? null;
        },
        // Run cost goes only to a key whose organisation has chosen to share it with AI (the same owner switch as Ask Atlas): an API key is often handed to an outside AI client, so the default is to withhold it.
        createContext: async (model, commitId, orgId) => {
          const { data, error } = await supabase.from('organisations').select('ai_share_run_cost').eq('id', orgId).maybeSingle();
          if (error) throw new Error(`Could not read the organisation: ${error.message}`);
          const share = (data as { ai_share_run_cost?: boolean } | null)?.ai_share_run_cost === true;
          return createToolContext(supabase, model, commitId, { runCost: share ? 'share' : 'exclude' });
        },
      },
      { method: req.method, path, query: url.searchParams, authorization: req.headers.get('Authorization') },
    );
    const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'X-Atlas-Api-Version': 'v1', 'Cache-Control': 'no-store', ...result.headers };
    return new Response(req.method === 'HEAD' ? null : JSON.stringify(result.body), { status: result.status, headers });
  } catch (e) {
    // Never echo internals to an API caller; the cause is in the function's own logs.
    console.error('api: request failed', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong reading the model. Try again.' } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
