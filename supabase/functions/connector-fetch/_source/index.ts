/**
 * Live connectors (docs/ADR-032-connectors.md): reads another tool on behalf
 * of an organisation and returns the file its import source already reads.
 * A thin transport shim: every decision lives in `src/connectors/handler.ts`,
 * tested with Vitest.
 *
 * Invoked by the signed-in user's own session (JWT verified by the platform).
 * The connector row is read with that session, so row-level security (owner
 * or architect of the organisation) is the permission check. Only then does
 * the service role read the one secret out of Supabase Vault. The secret is
 * never returned or logged. Nothing is written except the connector's
 * "last fetch" note.
 *
 * **Hand-authored source, not what is deployed**: `pnpm functions:bundle:connector-fetch`
 * bundles this plus its `src/` imports into the generated, git-ignored
 * `supabase/functions/connector-fetch/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { handleConnectorFetch } from '../../../../src/connectors/handler.ts';
import { realHttp } from '../../../../src/connectors/http.ts';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', code: 'invalid', message: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ status: 'error', code: 'forbidden', message: 'Missing Authorization header.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse({ status: 'error', code: 'failed', message: 'The function is not configured.' }, 500);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: 'error', code: 'invalid', message: 'Invalid JSON.' }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- as above.
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const result = await handleConnectorFetch(
      {
        loadConnector: async (orgId, kind) => {
          const { data, error } = await asUser.from('org_connectors').select('*').eq('org_id', orgId).eq('kind', kind).maybeSingle();
          if (error) throw new Error(`Could not read the connector: ${error.message}`);
          return data as never;
        },
        readSecret: async (connectorId) => {
          const { data, error } = await service.schema('atlas').rpc('connector_secret', { p_connector_id: connectorId });
          if (error) throw new Error('Could not read the saved secret.');
          return typeof data === 'string' ? data : null;
        },
        recordOutcome: async (connectorId, status, message) => {
          const { error } = await service.schema('atlas').rpc('record_connector_fetch', { p_connector_id: connectorId, p_status: status, p_message: message });
          if (error) console.error('connector-fetch: could not record the outcome', error.message);
        },
        runtime: { http: realHttp, now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
      },
      body,
    );
    return jsonResponse(result, 200);
  } catch (e) {
    console.error('connector-fetch: failed', e instanceof Error ? e.message : e);
    return jsonResponse({ status: 'error', code: 'failed', message: 'Something went wrong. Try again.' }, 200);
  }
});
