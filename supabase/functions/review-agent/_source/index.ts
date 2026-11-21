/** D2 second opinions. All reads use the caller's session and RLS; no write privileges or service key. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../../_shared/cors.ts';
import { handleReview } from '../../../../src/tools/reviewHandler.ts';
import { createToolContext } from '../../../../src/tools/loadContext.ts';
import { createProxyAskClient, AskProviderError } from '../../../../src/tools/proxyClient.ts';
import { listGoalLinksForGoals } from '../../../../src/db/goals.ts';
import type { GoalRow } from '../../../../src/contracts/goals.ts';
import { adrPrincipleItems, goalTitlesServedBy } from '../../../../src/engine/decisionDigest/relatedContext.ts';
import { selectAll } from '../../../../src/db/selectAll.ts';
import type { BranchRow, DecisionLinkRow, DecisionOptionRatingRow, DecisionRow } from '../../../../src/db/types.ts';
import type { DecisionPrincipleRow, PrincipleRow } from '../../../../src/contracts/principles.ts';

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
  try { body = await req.json(); } catch { return jsonResponse({ status: 'error', message: 'Invalid JSON.' }, 400); }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime; the caller token remains on every query.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  try {
    const outcome = await handleReview({
      loadDecision: async (id) => {
        const { data, error } = await supabase.from('decisions').select('*').eq('id', id).maybeSingle();
        if (error) throw new Error('Could not read the decision.');
        return data as DecisionRow | null;
      },
      loadModel: async (id) => {
        const { data, error } = await supabase.from('models').select('id, org_id, name').eq('id', id).maybeSingle();
        if (error) throw new Error('Could not read the model.');
        const row = data as { id: string; org_id: string; name: string } | null;
        return row ? { id: row.id, orgId: row.org_id, name: row.name } : null;
      },
      callerRole: async (orgId) => {
        const { data: auth, error } = await supabase.auth.getUser();
        if (error || !auth.user) return null;
        const { data: member, error: memberError } = await supabase.from('members').select('role').eq('org_id', orgId).eq('user_id', auth.user.id).maybeSingle();
        return memberError ? null : (member as { role: string } | null)?.role ?? null;
      },
      settings: async (orgId) => {
        const { data, error } = await supabase.from('organisations').select('ai_assistant_enabled, ai_agents_enabled, ai_agent_key_set, ai_share_run_cost').eq('id', orgId).maybeSingle();
        if (error || !data) throw new Error('Could not read agent settings.');
        const row = data as { ai_assistant_enabled: boolean; ai_agents_enabled: boolean; ai_agent_key_set: boolean; ai_share_run_cost: boolean };
        return { assistantEnabled: row.ai_assistant_enabled === true, agentsEnabled: row.ai_agents_enabled === true, keySet: row.ai_agent_key_set === true, shareCost: row.ai_share_run_cost === true };
      },
      mainCommit: async (modelId) => {
        const { data, error } = await supabase.from('branches').select('head_commit_id').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
        if (error) throw new Error('Could not read the model head.');
        return (data as { head_commit_id?: string | null } | null)?.head_commit_id ?? null;
      },
      loadSavedReview: async (decision, snapshot) => {
        const [links, ratings, principleLinks, principles, goals] = await Promise.all([
          selectAll<DecisionLinkRow>(supabase.from('decision_links').select('*', { count: 'exact' }).eq('decision_id', decision.id).order('linked_type').order('linked_id')),
          selectAll<DecisionOptionRatingRow>(supabase.from('decision_option_ratings').select('*', { count: 'exact' }).eq('decision_id', decision.id).order('branch_id').order('criterion')),
          selectAll<DecisionPrincipleRow>(supabase.from('decision_principles').select('*', { count: 'exact' }).eq('decision_id', decision.id).order('principle_id')),
          selectAll<PrincipleRow>(supabase.from('principles').select('*', { count: 'exact' }).eq('model_id', decision.model_id).order('id')),
          selectAll<GoalRow>(supabase.from('goals').select('*', { count: 'exact' }).eq('model_id', decision.model_id).order('id')),
        ]);
        const branchIds = new Set(links.filter((l) => l.linked_type === 'branch').map((l) => l.linked_id));
        // Query by model, not an unbounded caller-derived .in() URL.
        const branches = await selectAll<BranchRow>(supabase.from('branches').select('id, title, name, description, model_id, org_id', { count: 'exact' }).eq('model_id', decision.model_id).eq('kind', 'change').order('id'));
        const options = branches.filter((b) => branchIds.has(b.id) && b.org_id === decision.org_id);
        if (options.length !== branchIds.size) throw new Error('Some saved options could not be read.');
        const concernIds = new Set(links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id));
        const relationshipIds = new Set(links.filter((l) => l.linked_type === 'relationship').map((l) => l.linked_id));
        const concerns = snapshot.elements.filter((e) => concernIds.has(e.element_id));
        const concernRelationships = snapshot.relationships.filter((r) => relationshipIds.has(r.relationship_id));
        const goalLinks = await listGoalLinksForGoals(supabase, goals.map((g) => g.id));
        return {
          decision, options, ratings, concerns, concernRelationships,
          principles: adrPrincipleItems(principles, principleLinks),
          goals: goalTitlesServedBy(concerns.filter((e) => e.element_type === 'capability').map((e) => e.element_id), goals.filter((g) => g.status === 'active'), goalLinks),
        };
      },
      createContext: (model, commitId, shareCost) => createToolContext(supabase, model, commitId, { runCost: shareCost ? 'share' : 'exclude' }),
      newRunId: () => crypto.randomUUID(),
      createClient: (orgId, runId, lens) => createProxyAskClient({ proxyUrl: `${supabaseUrl}/functions/v1/llm-proxy`, authorization: authHeader, anonKey: supabaseAnonKey, orgId, useOrgKey: true, requireOrgKey: true, ...(lens !== 'challenge' ? { modelTier: 'light' as const } : {}), runId }),
      hash: async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((n) => n.toString(16).padStart(2, '0')).join(''),
    }, body);
    if (outcome.status === 'invalid' || outcome.status === 'too_large') return jsonResponse(outcome, 400);
    if (outcome.status === 'forbidden' || outcome.status === 'not_enabled' || outcome.status === 'cost_blocked') return jsonResponse(outcome, 403);
    if (outcome.status === 'not_found') return jsonResponse(outcome, 404);
    return jsonResponse(outcome, 200);
  } catch (error) {
    if (error instanceof AskProviderError) return jsonResponse({ status: 'error', message: error.status === 403 ? error.message : 'The AI service could not answer. Try again.' }, error.status === 429 ? 429 : 502);
    console.error('review-agent: failed', error instanceof Error ? error.message : 'unknown');
    return jsonResponse({ status: 'error', message: 'The second opinion could not be prepared. Try again.' }, 500);
  }
});
