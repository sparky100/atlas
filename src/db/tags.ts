/**
 * Tag repository operations. Insert and read only — tags are immutable
 * once created (ADR-002), and the migration grants no update/delete to any
 * application role, so there is nothing else for this module to do.
 *
 * See src/db/branches.ts's module comment on the untyped client and the
 * narrow, marked `eslint-disable`s that come with it.
 */
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { Client } from './client';
import type { TagRow } from './types';
import type { UUID } from '../contracts/delta';
import { buildCommitLoader } from './commitLoader';
import { selectAll } from './selectAll';
import { verifyHeadMatchesFold } from '../engine/head';
import { deserializeHeadProjection } from '../engine/projection';

export interface CreateTagInput {
  /** Minted by the caller (S-1) — see the matching note on CreateChangeBranchInput. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  name: string;
  /** Must be a commit on the model's main branch — enforced by `atlas.guard_tag_on_main` regardless of what this call passes. */
  commitId: UUID;
  description?: string;
  createdBy: UUID;
}

/**
 * Reads the full materialised head at `commitId` — the exact set
 * `verifyHeadMatchesFold` below compares against the delta history.
 * Routed through `selectAll` (SPEC §6.7): this is the highest-stakes read
 * in the whole codebase to leave silently truncatable, since `createTag` is
 * "the one moment the cost is always paid" (this function's own doc
 * comment) — a truncated `elements_head`/`relationships_head`/`facts` read
 * here wouldn't tag a wrong commit (the hash mismatch would still catch
 * that and fail loudly), but it would make every model past ~1,000
 * elements/relationships/facts unable to ever create a tag at all, for a
 * reason with no visible error pointing at it.
 */
export async function loadMaterialisedHead(supabase: Client, commitId: UUID) {
  const [elementsData, relationshipsData, factsData] = await Promise.all([
    selectAll<ElementsHeadRow>(supabase.from('elements_head').select('*', { count: 'exact' }).eq('commit_id', commitId).order('element_id')),
    selectAll<RelationshipsHeadRow>(supabase.from('relationships_head').select('*', { count: 'exact' }).eq('commit_id', commitId).order('relationship_id')),
    selectAll<FactsRow>(supabase.from('facts').select('*', { count: 'exact' }).eq('commit_id', commitId).order('subject_id').order('attribute')),
  ]);
  return deserializeHeadProjection(elementsData, relationshipsData, factsData);
}

/**
 * Tags `input.commitId` with `input.name`, but only after recomputing
 * `fold(commit)` from genesis and confirming it still matches what
 * `elements_head`/`relationships_head`/`facts` currently say (SPEC §6.6
 * point 3: "A tag is the one moment the cost is always paid, so that
 * anything a version is cited for was verified from first principles";
 * P-7 exercises exactly this — a corrupted `elements_head` row must fail
 * tag creation, not get cited by a version). `verifyHeadMatchesFold`
 * (src/engine/head.ts) is the same check the nightly integrity job runs;
 * this is its other caller.
 *
 * `RLS`'s own `tags_insert` policy still enforces the role gate (owner/
 * architect) and `atlas.guard_tag_on_main` still enforces "a real commit
 * on this model's main branch" — this function adds the one thing a
 * database CHECK constraint can't express: that the delta history and the
 * materialised projection actually agree.
 */
export async function createTag(supabase: Client, input: CreateTagInput): Promise<TagRow> {
  const [claimedHead, loader] = await Promise.all([loadMaterialisedHead(supabase, input.commitId), buildCommitLoader(supabase, input.modelId)]);
  const verification = verifyHeadMatchesFold(claimedHead, input.commitId, loader);
  if (!verification.ok) {
    throw new Error(
      `createTag: commit ${input.commitId}'s materialised projection does not match its delta history (expected head_hash ${verification.expectedHash}, found ${verification.actualHash}) — refusing to tag a commit whose integrity can't be verified`,
    );
  }

  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    commit_id: input.commitId,
    description: input.description ?? null,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('tags').insert(row).select('*').single();
  if (error) throw new Error(`createTag: ${error.message}`);
  return data as TagRow;
}

export async function listTagsForModel(supabase: Client, modelId: UUID): Promise<TagRow[]> {
  const { data, error } = await supabase.from('tags').select('*').eq('model_id', modelId);
  if (error) throw new Error(`listTagsForModel: ${error.message}`);
  return data as TagRow[];
}
