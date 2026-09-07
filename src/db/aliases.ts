/**
 * `aliases` repository operations. Thin, typed wrapper — see branches.ts's
 * module comment for the untyped-client `eslint-disable` boundary this
 * follows.
 *
 * Only `name`/`code`/`external_ref`/`source_system_key` are insertable
 * through this module: `aliases_insert`'s RLS policy
 * (supabase/migrations/20260906071500_sources_and_aliases.sql) allows an
 * `authenticated` insert for exactly those four — `template_code` (capture-
 * import seeding, atlas.seed_from_map, src/db/seedFromMap.ts) and
 * `merged_id` (the future atlas.merge_elements) are system paths a plain
 * client insert can never satisfy, by design.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { AliasRow } from './types';

/**
 * Every element's alias values, grouped by `element_id` — exactly the shape
 * `classifyMerge`'s optional `aliasesByElementId` (src/engine/merge.ts)
 * takes for the "identity (strong)" check. `merged_id` is excluded, same as
 * `listAliasesForElement`: it names a *merged-away* element's old id, not a
 * name/code a newly-created element could plausibly collide with.
 */
export async function listAliasesForModel(supabase: Client, modelId: UUID): Promise<Map<UUID, string[]>> {
  const { data, error } = await supabase.from('aliases').select('element_id, alias_value').eq('model_id', modelId).neq('alias_type', 'merged_id');
  if (error) throw new Error(`listAliasesForModel: ${error.message}`);
  const rows = data as { element_id: UUID; alias_value: string }[];
  const byElementId = new Map<UUID, string[]>();
  for (const row of rows) {
    const list = byElementId.get(row.element_id);
    if (list) list.push(row.alias_value);
    else byElementId.set(row.element_id, [row.alias_value]);
  }
  return byElementId;
}

export type DirectlyInsertableAliasType = 'name' | 'code' | 'external_ref' | 'source_system_key';

export interface CreateAliasInput {
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  elementId: UUID;
  aliasValue: string;
  aliasType: DirectlyInsertableAliasType;
  sourceId: UUID;
  createdBy: UUID;
}

/**
 * Records one alias. Confidence is always 1.0 here: every caller through
 * this module is asserting something it directly observed (a rename, a
 * manually-entered code), never a scored capture guess.
 */
export async function createAlias(supabase: Client, input: CreateAliasInput): Promise<AliasRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    element_id: input.elementId,
    alias_value: input.aliasValue,
    alias_type: input.aliasType,
    source_id: input.sourceId,
    confidence: 1,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('aliases').insert(row).select('*').single();
  if (error) throw new Error(`createAlias: ${error.message}`);
  return data as AliasRow;
}
