/**
 * The tailoring flow's "import" action: seed a model's (still-empty-of-
 * content) main branch from a published starter capability map
 * (SPEC-data-model.md §3.10/§5.1, ADR-012). One `template_seed` commit,
 * parented on main's existing genesis commit (ADR-018: main always has a
 * real head, even before this runs — only the trigger-inserted `genesis`
 * commit itself is ever allowed a null parent), whose `element.create`
 * deltas carry `attributes.templateRef`/`attributes.order`
 * (Sprint U4-1 C1: `capability_map_items.item_order`, always present —
 * the content schema requires one on every item)/(when the map item has
 * one) `attributes.description`, plus one `sources` row (kind `template`)
 * and one `aliases` row per element (`template_code`, RT-4) recording
 * which starter map and version seeded this model. `attributes.code`
 * ("Reference") is deliberately **not** set here (ADR-020) — it's an
 * organisation's own optional field now, not a copy of the template's
 * code, which stays reachable via `templateRef` and the `template_code`
 * alias alone.
 *
 * `attributes.description` (Bug A2 fix — it was previously dropped
 * silently) carries the same provenance as `name`: it's the map item's own
 * fact, `sourceId`/confidence 1 from this same seed commit, not something
 * that needs its own delta or source.
 *
 * Same division of labour as src/db/commits.ts: this builds the deltas and
 * folds them through the real engine (src/engine/deltas.ts's `fold`, from
 * `emptyHead()` rather than an existing head — a seed has no history to
 * fold onto) to get a validated, hashed projection, then hands the result
 * to `atlas.seed_from_map` (supabase/migrations/20260906120000_seed_from_map.sql,
 * most recently 20260906370000_seed_from_map_parent_commit_fix.sql) to
 * persist atomically. That function, not this one, is where "only
 * owner/architect", "only once per model", and "the map must be published"
 * are actually enforced — this is a client, not the authority.
 *
 * `expectedHeadCommitId`, like every other commit path (`commitToBranch`'s
 * own field of the same name): the caller's own `getMainBranch` read of
 * `main.head_commit_id` — main's genesis commit for a real, never-yet-
 * seeded model (ADR-018 guarantees this is never null). The RPC re-reads
 * the real head itself and rejects if it has moved since, the same
 * optimistic-concurrency shape as every other write here.
 */
import type { CapabilityMapItemRow, CapabilityMapValueStreamEnablesRow, CapabilityMapValueStreamItemRow } from './capabilityMapTemplates';
import { listCapabilityMapValueStreamEnables, listCapabilityMapValueStreamItems } from './capabilityMapTemplates';
import type { CapabilityAttributes, ValueStreamAttributes, UUID } from '../contracts/delta';
import type { Delta } from '../contracts/delta';
import { cloneHead, emptyHead, fold, type Head } from '../engine/deltas';
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
  valueStreams: readonly CapabilityMapValueStreamItemRow[] = [],
  enables: readonly CapabilityMapValueStreamEnablesRow[] = [],
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
    // ADR-020: `code` ("Reference") is never set at seed time — an
    // organisation's own optional field, not a copy of the template's
    // code, which stays reachable via `templateRef` and the
    // `template_code` alias (`aliases.push` below) alone.
    const attributes: CapabilityAttributes = { templateRef: item.id, order: item.item_order };
    const description = item.description?.trim();
    if (description) attributes.description = description;
    deltas.push({
      kind: 'element.create',
      id: deltaId,
      elementId,
      elementType: 'capability',
      name: item.name,
      parentId,
      attributes,
      sourceId,
      confidence: 1, // "template seeds are 1.00" (src/contracts/delta.ts's Provenance doc comment).
    });
    aliases.push({ id: mintId(), elementId, aliasValue: item.code });
  }

  // F6 (ADR-023): value streams seed alongside capabilities — streams
  // first (parent_code null), then stages (parent_code = their stream),
  // then the `enables` edges once every stage exists, so C22 (a stage's
  // parent is a stream; `enables` targets a stage) holds within the commit.
  const valueStreamIdByCode = new Map(valueStreams.map((vs) => [vs.code, mintId()]));
  const sortedValueStreams = [...valueStreams].sort((a, b) => (a.parent_code === null ? -1 : 1) - (b.parent_code === null ? -1 : 1));
  for (const vs of sortedValueStreams) {
    const elementId = valueStreamIdByCode.get(vs.code);
    if (!elementId) throw new Error(`buildSeedDeltas: no minted id for value stream code "${vs.code}"`);
    const parentId = vs.parent_code === null ? null : (valueStreamIdByCode.get(vs.parent_code) ?? null);
    if (vs.parent_code !== null && parentId === null) {
      throw new Error(`buildSeedDeltas: value stream "${vs.code}" names parent "${vs.parent_code}", which is not among the value streams given`);
    }

    const attributes: ValueStreamAttributes = { templateRef: vs.id, order: vs.item_order };
    const description = vs.description?.trim();
    if (description) attributes.description = description;
    deltas.push({
      kind: 'element.create',
      id: mintId(),
      elementId,
      elementType: 'value_stream',
      name: vs.name,
      parentId,
      attributes,
      sourceId,
      confidence: 1,
    });
    aliases.push({ id: mintId(), elementId, aliasValue: vs.code });
  }

  for (const edge of enables) {
    const fromElementId = elementIdByCode.get(edge.capability_code);
    if (!fromElementId) throw new Error(`buildSeedDeltas: enables names capability_code "${edge.capability_code}", which is not among the items given`);
    const toElementId = valueStreamIdByCode.get(edge.stage_code);
    if (!toElementId) throw new Error(`buildSeedDeltas: enables names stage_code "${edge.stage_code}", which is not among the value streams given`);
    deltas.push({
      kind: 'relationship.create',
      id: mintId(),
      relationshipId: mintId(),
      relationshipType: 'enables',
      fromElementId,
      toElementId,
      attributes: {},
      sourceId,
      confidence: 1,
    });
  }

  return { deltas, aliases };
}

export interface SeedModelFromCapabilityMapInput {
  modelId: UUID;
  branchId: UUID;
  /** `main`'s own current head — its genesis commit, for a real never-yet-seeded model (ADR-018). The RPC's own optimistic-concurrency check (`p_expected_head_commit_id`, 20260906370000_seed_from_map_parent_commit_fix.sql). */
  expectedHeadCommitId: UUID;
  authorId: UUID;
  capabilityMapId: UUID;
  /** e.g. "local_government" — used only to build `p_title`/`p_source_name`; the RPC re-derives everything it actually checks from `capabilityMapId` itself. */
  sector: string;
  version: number;
  items: readonly CapabilityMapItemRow[];
}

export type SeedResult = { ok: true; commitId: UUID; newHead: Head } | { ok: false; message: string };

/**
 * Folds `input.items` into a `template_seed` commit and persists it via
 * `atlas.seed_from_map`. `input.branchId` must still be at its genesis
 * commit — no real content yet — since a model is seeded at most once
 * (SPEC §5.1); later tailoring is ordinary `manual` commits through
 * src/db/commits.ts, not a second call here.
 */
export async function seedModelFromCapabilityMap(supabase: Client, input: SeedModelFromCapabilityMapInput): Promise<SeedResult> {
  const { modelId, branchId, expectedHeadCommitId, authorId, capabilityMapId, sector, version, items } = input;
  if (items.length === 0) {
    return { ok: false, message: 'this capability map has no items to seed' };
  }

  const commitId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  // F6 (ADR-023): a map may also carry value streams and their `enables`
  // edges — fetched here (never passed by the caller) so every existing
  // caller seeds a map's full content, not just its capabilities.
  const [valueStreams, enables] = await Promise.all([
    listCapabilityMapValueStreamItems(supabase, capabilityMapId),
    listCapabilityMapValueStreamEnables(supabase, capabilityMapId),
  ]);
  const { deltas, aliases } = buildSeedDeltas(items, sourceId, () => crypto.randomUUID(), valueStreams, enables);

  const head = fold(cloneHead(emptyHead()), deltas, { authorId, createdAt: new Date().toISOString() });
  const projection = serializeHeadProjection(head);

  // .schema('atlas'): this RPC lives in the atlas schema (SPEC §2), not
  // public — see src/db/commits.ts's own note on why this is required.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('seed_from_map', {
    p_commit_id: commitId,
    p_model_id: modelId,
    p_branch_id: branchId,
    p_expected_head_commit_id: expectedHeadCommitId,
    p_title: `Seed from ${sector} v${String(version)}`,
    p_capability_map_id: capabilityMapId,
    p_source_id: sourceId,
    p_source_name: `Capability map seed: ${sector} v${String(version)}`,
    p_deltas: deltas.map((delta) => deltaToRpcRow(delta)),
    p_elements_head: projection.elementsHead,
    // F6 (ADR-023): `20260921070000_value_streams.sql` — `[]` until a map
    // carries value streams and this seeder emits their `enables` edges.
    p_relationships_head: projection.relationshipsHead,
    p_facts: projection.facts,
    p_aliases: aliases.map((alias) => ({ id: alias.id, element_id: alias.elementId, alias_value: alias.aliasValue, confidence: 1 })),
    p_head_hash: headHash(head),
  } satisfies Record<string, unknown>);

  if (error) return { ok: false, message: error.message };
  const commitRow = data as { id: UUID };
  return { ok: true, commitId: commitRow.id, newHead: head };
}

/**
 * `Delta` → the jsonb shape `atlas.seed_from_map` inserts into `deltas`
 * verbatim — the same subset-of-`DeltaRow` mapping src/db/commits.ts uses
 * for `commit_deltas`, reproduced here rather than shared because this flow
 * only ever has two delta kinds (`element.create`, and — F6/ADR-023 —
 * `relationship.create` for an `enables` edge) and doesn't need
 * `envelopeToDeltaRows`'s full generality (it has no `CommitEnvelope` to
 * convert — `seed_from_map` takes no `parentCommitId`/
 * `mergedBranchHeadCommitId` at all, genesis has neither) — `commit_id`
 * isn't part of the row itself: `seed_from_map` inserts every delta under
 * its own `p_commit_id` parameter, not a per-row value.
 *
 * `previous_delta_id: null` throughout: every delta here is a create (an
 * `element.create` or `relationship.create`), which never has a prior fact
 * to reference regardless of whether its commit's own parent is a genesis
 * commit or something later.
 */
function deltaToRpcRow(delta: Delta): Record<string, unknown> {
  if (delta.kind === 'element.create') {
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
  if (delta.kind === 'relationship.create') {
    return {
      id: delta.id,
      kind: 'relationship_create',
      subject_id: delta.relationshipId,
      attribute: '$exists',
      element_type: null,
      relationship_type: delta.relationshipType,
      name: null,
      parent_id: null,
      from_element_id: delta.fromElementId,
      to_element_id: delta.toElementId,
      value: delta.attributes,
      previous_delta_id: null,
      source_id: delta.sourceId,
      source_ref: delta.sourceRef ?? null,
      effective_date: delta.effectiveDate ?? null,
      confidence: delta.confidence,
    };
  }
  throw new Error(`deltaToRpcRow: seeding only ever produces element.create / relationship.create deltas, got ${delta.kind}`);
}
