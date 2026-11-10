/**
 * Owner-only "Copy this model" (docs/ADR-030-copy-model.md). Same division of
 * labour as src/db/seedFromMap.ts: this reads the source model's current main
 * head, has the engine (src/engine/copyModel.ts) build one commit's deltas
 * with fresh ids, folds them through the real engine to get a validated,
 * hashed projection, and hands the result to `atlas.copy_model`
 * (supabase/migrations/20261110010000_copy_model.sql). That function — not
 * this one — is where "only an owner" and "main did not move" are enforced.
 *
 * Same organisation only: copying into another organisation is a separate,
 * later decision (the ADR names it as deferred).
 */
import type { Delta, UUID } from '../contracts/delta';
import { toDeltaRow } from '../contracts/rows';
import { buildCopyPlan } from '../engine/copyModel';
import { cloneHead, emptyHead, fold } from '../engine/deltas';
import { headHash } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { loadMaterialisedHead } from './tags';
import type { ModelRow } from './types';

export interface CopyModelInput {
  source: ModelRow;
  /** The new model's name; the caller trims and defaults it ("<name> (copy)"). */
  name: string;
  slug: string;
  description?: string | null;
  authorId: UUID;
}

export type CopyModelResult = { ok: true; model: ModelRow; copiedElements: number; copiedRelationships: number } | { ok: false; message: string };

/** "Atlas (copy)", then "Atlas (copy 2)", ... — the first name not already used by `existingNames` (case-insensitive). */
export function defaultCopyName(sourceName: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const first = `${sourceName} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${sourceName} (copy ${String(n)})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** A URL-safe slug for `name` that is not already in `existingSlugs` ("-2", "-3" ... appended on a clash). */
export function slugForCopy(name: string, existingSlugs: readonly string[]): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
  const taken = new Set(existingSlugs);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
  }
}

export async function copyModel(supabase: Client, input: CopyModelInput): Promise<CopyModelResult> {
  const { source, name, slug, authorId } = input;
  const main = await getMainBranch(supabase, source.id);
  if (!main) return { ok: false, message: 'This model has no main branch to copy.' };

  const head = await loadMaterialisedHead(supabase, main.head_commit_id);
  if (head.elements.size === 0) return { ok: false, message: 'There is nothing in this model to copy yet.' };

  // One new source id per source the copied facts actually name.
  const sourceIdsUsed = new Set([...head.facts.values()].map((fact) => fact.sourceId));
  const sourceIdMap = new Map([...sourceIdsUsed].sort().map((old) => [old, crypto.randomUUID()] as const));
  const plan = buildCopyPlan(head, sourceIdMap, () => crypto.randomUUID());

  const newModelId = crypto.randomUUID();
  const commitId = crypto.randomUUID();
  const copied = fold(cloneHead(emptyHead()), plan.deltas, { authorId, createdAt: new Date().toISOString() });
  const projection = serializeHeadProjection(copied);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('copy_model', {
    p_source_model_id: source.id,
    p_expected_source_head_commit_id: main.head_commit_id,
    p_new_model_id: newModelId,
    p_name: name,
    p_slug: slug,
    p_description: input.description ?? source.description,
    p_commit_id: commitId,
    p_title: `Copied from ${source.name}`,
    p_source_map: [...sourceIdMap].map(([oldId, newId]) => ({ old: oldId, new: newId })),
    p_element_map: Object.fromEntries(plan.elementIdMap),
    p_deltas: plan.deltas.map((delta) => deltaToWireRow(delta)),
    p_elements_head: projection.elementsHead,
    p_relationships_head: projection.relationshipsHead,
    p_facts: projection.facts,
    p_head_hash: headHash(copied),
  } satisfies Record<string, unknown>);
  if (error) return { ok: false, message: error.message };
  return { ok: true, model: data as ModelRow, copiedElements: copied.elements.size, copiedRelationships: copied.relationships.size };
}

/** The `deltas` row shape `atlas.copy_model` reads by field name — org/model/commit/seq are supplied by the function itself, so the context here is placeholders it ignores. */
function deltaToWireRow(delta: Delta): Record<string, unknown> {
  return { ...toDeltaRow(delta, { orgId: '', modelId: '', commitId: '', seq: 0, createdBy: '' }) };
}
