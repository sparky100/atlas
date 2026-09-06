/**
 * The tailoring flow's "import" action: seed a model's (empty) main branch
 * from a published starter capability map (SPEC-data-model.md §3.10/§5.1,
 * ADR-012). One `template_seed` commit — the model's genesis commit, the
 * only kind that can ever have a null `parentCommitId` — whose
 * `element.create` deltas carry `attributes.code`/`attributes.templateRef`,
 * plus one `sources` row (kind `template`) and one `aliases` row per
 * element (`template_code`, RT-4) recording which starter map and version
 * seeded this model.
 *
 * Same division of labour as src/db/commits.ts: this builds the deltas and
 * folds them through the real engine (src/engine/deltas.ts's `fold`, from
 * `emptyHead()` rather than an existing head — a seed has no history to
 * fold onto) to get a validated, hashed projection, then hands the result
 * to `atlas.seed_from_map` (supabase/migrations/20260906120000_seed_from_map.sql)
 * to persist atomically. That function, not this one, is where "only
 * owner/architect", "only once per model", and "the map must be published"
 * are actually enforced — this is a client, not the authority.
 */
import type { CapabilityMapItemRow } from './capabilityMapTemplates';
import type { UUID } from '../contracts/delta';
import type { Delta } from '../contracts/delta';
import { cloneHead, emptyHead, fold } from '../engine/deltas';
import { headHash } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import type { Client } from './client';

/** One `capability_map_items` row, seeded into one model element. */
export interface SeedElement {
  elementId: UUID;
  deltaId: UUID;
  item: CapabilityMapItemRow;
}

export interface SeedAlias {
  id: UUID;
  elementId: UUID;
  aliasValue: string;
}

/**
 * Mints one fresh element per map item (never `item.id` itself —
 * `capability_map_items.id` is template content, distinct from the model's
 * own element ids, per `attributes.templateRef`'s doc comment in
 * src/contracts/delta.ts) and builds the `element.create` delta for each,
 * parent-first (mirrors scripts/loadCapabilityMaps.ts's own two-pass
 * approach: assign every id before any row needs to reference one).
 *
 * Pure and independently testable — `mintId` defaults to `crypto.randomUUID`
 * but is injectable so a test can assert against known ids without an
 * unreadable UUID regex.
 */
export function buildSeedDeltas(
  items: readonly CapabilityMapItemRow[],
  sourceId: UUID,
  mintId: () => UUID = () => crypto.randomUUID(),
): { deltas: Delta[]; aliases: SeedAlias[] } {
  const elementIdByCode = new Map(items.map((item) => [item.code, mintId()]));
  const sorted = [...items].sort((a, b) => a.level - b.level);

  const deltas: Delta[] = [];
  const aliases: SeedAlias[] = [];
  for (const item of sorted) {
    const elementId = elementIdByCode.get(item.code);
    if (!elementId) throw new Error(`buildSeedDeltas: no minted id for item code "${item.code}"`);
    const parentId = item.parent_code === null ? null : (elementIdByCode.get(item.parent_code) ?? null);
    if (item.parent_code !== null && parentId === null) {
      throw new Error(`buildSeedDeltas: item "${item.code}" names parent "${item.parent_code}", which is not among the items given`);
    }

    const deltaId = mintId();
    deltas.push({
      kind: 'element.create',
      id: deltaId,
      elementId,
      elementType: 'capability',
      name: item.name,
      parentId,
      attributes: { code: item.code, templateRef: item.id },
      sourceId,
      confidence: 1, // "template seeds are 1.00" (src/contracts/delta.ts's Provenance doc comment).
    });
    aliases.push({ id: mintId(), elementId, aliasValue: item.code });
  }

  return { deltas, aliases };
}

export interface SeedModelFromCapabilityMapInput {
  modelId: UUID;
  branchId: UUID;
  authorId: UUID;
  capabilityMapId: UUID;
  /** e.g. "local_government" — used only to build `p_message`/`p_source_name`; the RPC re-derives everything it actually checks from `capabilityMapId` itself. */
  sector: string;
  version: number;
  items: readonly CapabilityMapItemRow[];
}

export type SeedResult = { ok: true; commitId: UUID } | { ok: false; message: string };

/**
 * Folds `input.items` into a genesis `template_seed` commit and persists it
 * via `atlas.seed_from_map`. `input.branchId` must be a model with no
 * commits yet at all — this is the model's first commit, never a later
 * addition (SPEC §5.1); later tailoring is ordinary `manual` commits
 * through src/db/commits.ts, not a second call here.
 */
export async function seedModelFromCapabilityMap(supabase: Client, input: SeedModelFromCapabilityMapInput): Promise<SeedResult> {
  const { modelId, branchId, authorId, capabilityMapId, sector, version, items } = input;
  if (items.length === 0) {
    return { ok: false, message: 'this capability map has no items to seed' };
  }

  const commitId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const { deltas, aliases } = buildSeedDeltas(items, sourceId);

  const head = fold(cloneHead(emptyHead()), deltas, { authorId, createdAt: new Date().toISOString() });
  const projection = serializeHeadProjection(head);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.rpc('seed_from_map', {
    p_commit_id: commitId,
    p_model_id: modelId,
    p_branch_id: branchId,
    p_message: `Seed from ${sector} v${String(version)}`,
    p_capability_map_id: capabilityMapId,
    p_source_id: sourceId,
    p_source_name: `Capability map seed: ${sector} v${String(version)}`,
    p_deltas: deltas.map((delta) => deltaToRpcRow(delta)),
    p_elements_head: projection.elementsHead,
    p_facts: projection.facts,
    p_aliases: aliases.map((alias) => ({ id: alias.id, element_id: alias.elementId, alias_value: alias.aliasValue, confidence: 1 })),
    p_head_hash: headHash(head),
  } satisfies Record<string, unknown>);

  if (error) return { ok: false, message: error.message };
  const commitRow = data as { id: UUID };
  return { ok: true, commitId: commitRow.id };
}

/**
 * `Delta` (an `element.create`, always, for this flow) → the jsonb shape
 * `atlas.seed_from_map` inserts into `deltas` verbatim — the same
 * subset-of-`DeltaRow` mapping src/db/commits.ts uses for `commit_deltas`,
 * reproduced here rather than shared because this flow only ever has one
 * delta kind and doesn't need `envelopeToDeltaRows`'s full generality (it
 * has no `CommitEnvelope` to convert — `seed_from_map` takes no
 * `parentCommitId`/`mergedBranchHeadCommitId` at all, genesis has neither) —
 * `commit_id` isn't part of the row itself: `seed_from_map` inserts every
 * delta under its own `p_commit_id` parameter, not a per-row value.
 */
function deltaToRpcRow(delta: Delta): Record<string, unknown> {
  if (delta.kind !== 'element.create') throw new Error(`deltaToRpcRow: seeding only ever produces element.create deltas, got ${delta.kind}`);
  return {
    id: delta.id,
    kind: 'element_create',
    subject_id: delta.elementId,
    attribute: '$exists',
    element_type: delta.elementType,
    relationship_type: null,
    name: delta.name,
    parent_id: delta.parentId,
    from_element_id: null,
    to_element_id: null,
    value: delta.attributes,
    previous_delta_id: null,
    source_id: delta.sourceId,
    source_ref: delta.sourceRef ?? null,
    effective_date: delta.effectiveDate ?? null,
    confidence: delta.confidence,
  };
}
