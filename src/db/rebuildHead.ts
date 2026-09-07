/**
 * Repair/verification path (SPEC-data-model.md §6.6's integrity job):
 * recompute main's head from genesis with the tested engine and rewrite
 * its `elements_head`/`relationships_head`/`facts` rows, whatever they
 * currently hold. Service-role only — this calls
 * `atlas.replace_main_head_projection` directly (not through
 * `atlas.commit_deltas`), which has no grant for `authenticated` at all
 * (supabase/migrations/20260906090000_facts_and_commit_deltas.sql).
 *
 * `replace_main_head_projection` is idempotent for a single commit_id (it
 * always clears that commit's own rows first, tagged or not), so calling
 * this on a model whose main head is already correctly materialised is
 * safe and changes nothing observable — which is exactly what lets this
 * double as both "repair a known-bad projection" and "verify a
 * known-good one," per SPEC §6.6 item 2's nightly integrity job.
 */
import type { UUID } from '../contracts/delta';
import { foldFromGenesis, headHash } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import { getMainBranch } from './branches';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';

export interface RebuildHeadResult {
  commitId: UUID;
  headHash: string;
  elementCount: number;
  relationshipCount: number;
  factCount: number;
}

/**
 * Recomputes and rewrites `modelId`'s main-branch head projection.
 * `serviceRoleClient` must be a service-role client (Client type is shared
 * with the anon-key client; nothing here checks the key itself — see
 * src/db/client.ts's own warning about using the service-role client only
 * off a real user's request path).
 */
export async function rebuildHead(serviceRoleClient: Client, modelId: UUID): Promise<RebuildHeadResult> {
  const main = await getMainBranch(serviceRoleClient, modelId);
  if (!main) throw new Error(`rebuildHead: model ${modelId} has no main branch`);
  if (!main.head_commit_id) throw new Error(`rebuildHead: model ${modelId}'s main branch has no commits yet`);

  const loader = await buildCommitLoader(serviceRoleClient, modelId);
  const head = foldFromGenesis(main.head_commit_id, loader);
  const projection = serializeHeadProjection(head);

  // .schema('atlas'): this RPC lives in the atlas schema (SPEC §2), not
  // public — see src/db/commits.ts's own note on why this is required.
  const { error } = await serviceRoleClient.schema('atlas').rpc('replace_main_head_projection', {
    p_org_id: main.org_id,
    p_model_id: modelId,
    // Same commit_id on both sides: this isn't advancing the head to a new
    // commit (commit_deltas's job), only re-materialising the one main
    // already points to — replace_main_head_projection's own idempotent
    // same-commit handling is what makes that safe.
    p_old_commit_id: main.head_commit_id,
    p_new_commit_id: main.head_commit_id,
    p_elements_head: projection.elementsHead,
    p_relationships_head: projection.relationshipsHead,
    p_facts: projection.facts,
  } satisfies Record<string, unknown>);
  if (error) throw new Error(`rebuildHead: ${error.message}`);

  return {
    commitId: main.head_commit_id,
    headHash: headHash(head),
    elementCount: projection.elementsHead.length,
    relationshipCount: projection.relationshipsHead.length,
    factCount: projection.facts.length,
  };
}
