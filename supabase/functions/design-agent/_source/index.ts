/**
 * Phase D step 2: the Designer agent's edge function. A thin transport shim:
 * every decision lives in `src/tools/designHandler.ts`, tested with Vitest.
 * What is here: read the caller's session, build collaborators that all use
 * the caller's own forwarded token (so row-level security is the authorisation
 * check for every read), and call the model through `llm-proxy` on the
 * organisation's OWN key (`useOrgKey`), or the free trial when no key is saved
 * (counted by `runId`). The proxy refuses unless agents are switched on and the
 * caller is an owner, architect or contributor.
 *
 * It never reads `SUPABASE_SERVICE_ROLE_KEY` and nothing here writes. The platform
 * key is used only inside the proxy's free trial.
 *
 * Response: `application/x-ndjson`. Each line is one of
 * `{"type":"event","event":{...}}` (a lookup started or finished),
 * `{"type":"result",...}` (the handler's outcome, `status` says `done`,
 * `invalid`, `not_found`, `forbidden`, `not_enabled` or `empty_model`) or
 * `{"type":"error",...}` (`rate_limited`, `provider` or `failed`). A request
 * that fails before the stream starts (bad auth, missing config, invalid JSON)
 * is still a plain JSON response with a non-200 status.
 *
 * **Hand-authored source, not what is deployed**: `pnpm functions:bundle:design-agent`
 * bundles this plus its `src/` imports into the generated, git-ignored
 * `supabase/functions/design-agent/index.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { handleDesign } from '../../../../src/tools/designHandler.ts';
import type { DesignTiming } from '../../../../src/tools/designHandler.ts';
import { createToolContext } from '../../../../src/tools/loadContext.ts';
import { summariseTrial, type TrialRow } from '../../../../src/contracts/trialAllowance.ts';
import { AskProviderError, createProxyAskClient } from '../../../../src/tools/proxyClient.ts';

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
  if (!supabaseUrl || !supabaseAnonKey) return jsonResponse({ status: 'error', message: 'This function is not configured.' }, 500);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400);
  }

  // The caller's own session for every read: RLS decides what is visible.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const startedAt = Date.now();
      const timings: DesignTiming[] = [];
      try {
        const outcome = await handleDesign(
          {
            onTiming: (timing) => {
              timings.push(timing);
            },
            loadModel: async (modelId) => {
              const { data, error } = await supabase.from('models').select('id, org_id, name').eq('id', modelId).maybeSingle();
              if (error) throw new Error('Could not read the model.');
              const row = data as { id: string; org_id: string; name: string } | null;
              return row ? { id: row.id, orgId: row.org_id, name: row.name } : null;
            },
            callerRole: async (orgId) => {
              const { data: userData, error: userError } = await supabase.auth.getUser();
              if (userError || !userData.user) return null;
              const { data, error } = await supabase.from('members').select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
              if (error) return null;
              return (data as { role?: string } | null)?.role ?? null;
            },
            agentSettings: async (orgId) => {
              const { data, error } = await supabase.from('organisations').select('ai_assistant_enabled, ai_agents_enabled, ai_agent_key_set').eq('id', orgId).maybeSingle();
              if (error) throw new Error('Could not read the organisation.');
              const row = data as { ai_assistant_enabled?: boolean; ai_agents_enabled?: boolean; ai_agent_key_set?: boolean } | null;
              return { assistantEnabled: row?.ai_assistant_enabled === true, agentsEnabled: row?.ai_agents_enabled === true, keySet: row?.ai_agent_key_set === true };
            },
            shareRunCost: async (orgId) => {
              const { data, error } = await supabase.from('organisations').select('ai_share_run_cost').eq('id', orgId).maybeSingle();
              if (error) throw new Error('Could not read the organisation.');
              return (data as { ai_share_run_cost?: boolean } | null)?.ai_share_run_cost === true;
            },
            trialRunsLeft: async (orgId) => {
              // Member-scoped read of the call log (counts only). Any failure reads as "none left": fail closed.
              const { data, error } = await supabase.from('llm_proxy_requests').select('key_source, status, run_id, input_tokens, output_tokens').eq('org_id', orgId).eq('key_source', 'trial').limit(2000);
              if (error) return 0;
              return summariseTrial((data as TrialRow[] | null) ?? []).runsLeft;
            },
            newRunId: () => crypto.randomUUID(),
            mainCommit: async (modelId) => {
              const { data, error } = await supabase.from('branches').select('head_commit_id').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
              if (error) throw new Error('Could not read the main line.');
              return (data as { head_commit_id?: string | null } | null)?.head_commit_id ?? null;
            },
            createContext: (model, commitId, runCost) => createToolContext(supabase, { id: model.id, name: model.name }, commitId, { runCost }),
            createClient: (orgId, runId) => createProxyAskClient({ proxyUrl: `${supabaseUrl}/functions/v1/llm-proxy`, authorization: authHeader, anonKey: supabaseAnonKey, orgId, useOrgKey: true, runId }),
          },
          body,
          (event) => send({ type: 'event', event }),
        );
        console.log('design-agent timing', JSON.stringify({ status: outcome.status, totalMs: Date.now() - startedAt, timings }));
        send({ type: 'result', ...outcome });
      } catch (e) {
        if (e instanceof AskProviderError) {
          send({
            type: 'error',
            code: e.status === 429 ? 'rate_limited' : 'provider',
            message: e.status === 429 ? 'Too many requests for this organisation this hour. Try again later.' : e.status === 403 ? e.message : 'The AI service could not answer. Check the organisation key in settings, then try again.',
          });
        } else {
          console.error('design-agent: failed', e instanceof Error ? e.message : 'unknown', JSON.stringify({ totalMs: Date.now() - startedAt, timings }));
          send({ type: 'error', code: 'failed', message: 'Something went wrong drafting the options. Try again.' });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
});
