/**
 * F2 (full K1) PR12, SPEC-capture.md §3.5: the capture pipeline's own edge
 * function. Invoked with `{jobId}` by the client (user JWT). Per §3.5:
 *
 * 1. Verifies the caller is a contributor+ member of the job's org by
 *    reading `capture_jobs` with the caller's own forwarded JWT —
 *    `capture_jobs_select`'s RLS does the actual check; a non-member or a
 *    nonexistent job simply reads back nothing, exactly `llm-proxy`'s own
 *    "re-derive server-side, never trust the client" pattern.
 * 2. Switches to the service role for everything after — `db.ts`'s
 *    `buildRealCaptureRunDeps`.
 * 3. Runs `src/capture/captureRunStep.ts`'s `runCaptureRunStep` — one
 *    invocation, job-level retry only (see that module's own comment for
 *    why K-12's literal per-chunk resumability is narrowed this way).
 *
 * This function itself is a thin transport shim by design — all the real
 * logic (the step machine, every dependency it needs) lives in
 * `src/capture/captureRunStep.ts` and `supabase/functions/capture-run/_source/db.ts`,
 * so it's Vitest-testable without a Deno runtime at all (K-15).
 *
 * **This is the hand-authored source, not what gets deployed.** Deno's edge
 * runtime does not honour the `sloppy-imports` unstable flag during
 * `supabase functions deploy`'s own graph-resolution step, so the
 * extension-less relative imports below (and everywhere in the `src/`
 * graph they reach into) fail to resolve there even though they resolve
 * fine for Vite/Vitest and for `deno check` locally — confirmed against a
 * real deploy attempt, not merely a disclosed risk. `scripts/bundleCaptureRunFunction.ts`
 * (`pnpm functions:bundle:capture-run`) bundles this file plus everything
 * it imports from `src/` into one flat, dependency-free
 * `supabase/functions/capture-run/index.ts` (generated, gitignored) with
 * only the `npm:`/URL specifiers left unresolved for Deno's own import map
 * to handle. Run that before every deploy — see `docs/EDGE-FUNCTIONS.md`'s
 * section on this function.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { CHANGE_BRIEF_FILENAME } from '../../../../src/contracts/capture.ts';
import { buildRealCaptureRunDeps, readJob } from './db.ts';
import { runCaptureRunStep } from '../../../../src/capture/captureRunStep.ts';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ status: 'error', message: 'Method not allowed.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({ status: 'error', message: 'Edge function is missing its own SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY — these are provided automatically by Supabase, this should not happen.' }, 500);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400);
    }
    const jobId = typeof body === 'object' && body !== null && typeof (body as { jobId?: unknown }).jobId === 'string' ? (body as { jobId: string }).jobId : null;
    if (!jobId) return jsonResponse({ status: 'error', message: 'jobId is required.' }, 400);

    // Step 1 (§3.5): the caller's own forwarded session, RLS-scoped —
    // `capture_jobs_select` requires contributor+ of the job's own org, so
    // a non-member or an unknown jobId both read back nothing here. This
    // is the real authorization check; everything from here on runs as
    // service role and trusts it.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const authorizedJob = await readJob(callerClient, jobId);
    if (!authorizedJob) return jsonResponse({ status: 'error', message: 'Capture job not found, or you are not a contributor+ member of its organisation.' }, 404);

    if (authorizedJob.inputKind === 'change_brief') {
      const [organisation, model] = await Promise.all([
        callerClient.from('organisations').select('ai_assistant_enabled').eq('id', authorizedJob.orgId).maybeSingle(),
        callerClient.from('models').select('id').eq('id', authorizedJob.modelId).eq('org_id', authorizedJob.orgId).maybeSingle(),
      ]);
      if (model.error || !model.data || authorizedJob.inputRef !== `capture-inputs/${authorizedJob.orgId}/${authorizedJob.modelId}/${authorizedJob.id}/${CHANGE_BRIEF_FILENAME}` || authorizedJob.targetBranchId !== null) {
        return jsonResponse({ status: 'error', message: 'The change brief does not belong to this model.' }, 403);
      }
      const { data, error } = organisation;
      if (error) throw new Error('Could not check the organisation AI setting.');
      if ((data as { ai_assistant_enabled?: boolean } | null)?.ai_assistant_enabled !== true) {
        return jsonResponse({ status: 'error', message: 'Enable Ask Atlas in organisation settings to draft with AI.' }, 403);
      }
    }

    // Step 2: service role for everything else. The caller's own session JWT
    // is forwarded through to llm-proxy — not the service-role key, which is
    // not a user-session JWT and would fail the proxy's own RLS membership
    // check ("Expected 3 parts in JWT; got 1"). The caller's contributor+
    // membership was already verified in step 1 against this same JWT, and
    // llm-proxy re-derives it the same way the browser path does.
    const callerToken = authHeader.replace(/^Bearer\s+/i, '');
    const deps = buildRealCaptureRunDeps({ supabaseUrl, serviceRoleKey, callerToken, orgId: authorizedJob.orgId, mintId: () => crypto.randomUUID() });

    // Step 3.
    const result = await runCaptureRunStep(deps, jobId);
    return jsonResponse(result, result.status === 'failed' ? 422 : 200);
  } catch (e) {
    return jsonResponse({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error running capture.' }, 500);
  }
});
