/**
 * F15 (ADR-028 §2): Ask Atlas's edge function. A thin transport shim — every
 * decision lives in `src/tools/askHandler.ts` and `askLoop.ts`, tested with
 * Vitest. What is here: read the caller's session, build collaborators that
 * all use the caller's own forwarded token (so row-level security is the
 * authorisation check), and stream progress as newline-delimited JSON.
 *
 * It never reads `SUPABASE_SERVICE_ROLE_KEY`, and nothing here writes.
 *
 * Response: `application/x-ndjson`. Each line is one of
 * `{"type":"event","event":{...}}` (a lookup started or finished),
 * `{"type":"result",...}` (its `status` says `done`, `not_found`, `disabled`,
 * `empty_model` or `invalid`) or `{"type":"error",...}` (`rate_limited`,
 * `provider`, `failed`).
 *
 * **Hand-authored source, not what is deployed**: `pnpm functions:bundle:ask-model`
 * bundles this plus its `src/` imports into the generated, git-ignored
 * `supabase/functions/ask-model/index.ts` (see `capture-run/_source/index.ts`
 * for why).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { handleAsk, type AskModelInfo } from '../../../../src/tools/askHandler.ts';
import { createToolContext } from '../../../../src/tools/loadContext.ts';
import { AskProviderError, createProxyAskClient } from '../../../../src/tools/proxyClient.ts';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ status: 'error', message: 'Edge function is missing its own SUPABASE_URL/SUPABASE_ANON_KEY — these are provided automatically by Supabase, this should not happen.' }, 500);
  }

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
      try {
        const outcome = await handleAsk(
          {
            loadModel: async (modelId) => {
              const { data, error } = await supabase.from('models').select('id, org_id, name').eq('id', modelId).maybeSingle();
              if (error) throw new Error(`Could not read the model: ${error.message}`);
              const row = data as { id: string; org_id: string; name: string } | null;
              return row ? { id: row.id, orgId: row.org_id, name: row.name } : null;
            },
            isEnabled: async (orgId) => {
              const { data, error } = await supabase.from('organisations').select('ai_assistant_enabled').eq('id', orgId).maybeSingle();
              if (error) throw new Error(`Could not read the organisation: ${error.message}`);
              return (data as { ai_assistant_enabled?: boolean } | null)?.ai_assistant_enabled === true;
            },
            mainCommit: async (modelId) => {
              const { data, error } = await supabase.from('branches').select('head_commit_id').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
              if (error) throw new Error(`Could not read the main line: ${error.message}`);
              return (data as { head_commit_id?: string | null } | null)?.head_commit_id ?? null;
            },
            createContext: (model: AskModelInfo, commitId) => createToolContext(supabase, { id: model.id, name: model.name }, commitId),
            createClient: (orgId) => createProxyAskClient({ proxyUrl: `${supabaseUrl}/functions/v1/llm-proxy`, authorization: authHeader, anonKey: supabaseAnonKey, orgId }),
          },
          body,
          (event) => send({ type: 'event', event }),
        );
        send({ type: 'result', ...outcome });
      } catch (e) {
        if (e instanceof AskProviderError) send({ type: 'error', code: e.status === 429 ? 'rate_limited' : 'provider', message: e.message });
        else send({ type: 'error', code: 'failed', message: e instanceof Error ? e.message : 'Unknown error answering the question.' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } });
});
