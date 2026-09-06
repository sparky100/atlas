/**
 * `sources` repository operations. Thin, typed wrapper — see
 * branches.ts's module comment for the untyped-client `eslint-disable`
 * boundary this follows.
 */
import type { Client } from './client';
import type { SourceRow } from './types';
import type { UUID } from '../contracts/delta';

export interface GetOrCreateManualSourceInput {
  /** Minted by the caller if a new row turns out to be needed. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  userId: UUID;
}

/**
 * A person's own manual edits all share one `sources` row per model
 * (`sources_model_id_user_id_manual_idx`, SPEC §3.6 — at most one
 * `kind = 'manual'` source per (model, user)). Editing (Sprint U1 step 5)
 * is this row's first real writer: find it if a previous edit already
 * created it, create it if not.
 */
export async function getOrCreateManualSource(supabase: Client, input: GetOrCreateManualSourceInput): Promise<SourceRow> {
  const existing = await supabase.from('sources').select('*').eq('model_id', input.modelId).eq('user_id', input.userId).eq('kind', 'manual').maybeSingle();
  if (existing.error) throw new Error(`getOrCreateManualSource: ${existing.error.message}`);
  if (existing.data) return existing.data as SourceRow;

  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, kind: 'manual' as const, name: 'Manual entry', user_id: input.userId, created_by: input.userId };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('sources').insert(row).select('*').single();
  if (error) throw new Error(`getOrCreateManualSource: ${error.message}`);
  return data as SourceRow;
}
