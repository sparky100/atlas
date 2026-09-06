/**
 * Tag repository operations. Insert and read only — tags are immutable
 * once created (ADR-002), and the migration grants no update/delete to any
 * application role, so there is nothing else for this module to do.
 *
 * See src/db/branches.ts's module comment on the untyped client and the
 * narrow, marked `eslint-disable`s that come with it.
 */
import type { Client } from './client';
import type { TagRow } from './types';
import type { UUID } from '../contracts/delta';

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

export async function createTag(supabase: Client, input: CreateTagInput): Promise<TagRow> {
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
