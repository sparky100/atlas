/**
 * Reads for the starter capability maps (SPEC §3.10, ADR-012) — product
 * content, no org_id, readable by every authenticated user
 * (supabase/migrations/20260906110000_capability_map_templates.sql).
 * Writing these tables is scripts/loadCapabilityMaps.ts's job, as
 * service_role; nothing here ever inserts/updates/deletes them.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

export type MapStatus = 'draft' | 'published' | 'deprecated';

export interface CapabilityMapRow {
  id: UUID;
  sector: string;
  version: number;
  status: MapStatus;
  /**
   * Sprint U4-2a item 4. `null` only for a row loaded before
   * 20260910010000_capability_maps_title_summary.sql added these columns
   * and not yet reloaded since — `src/contracts/capabilityMapContent.ts`'s
   * schema requires both on every *new* content file, but the column
   * itself is nullable (that migration's own comment explains why).
   * Callers fall back to `sector`/`version` (`title`) or omit the summary
   * line entirely (`summary`) rather than assume it's always there.
   */
  title: string | null;
  summary: string | null;
  source_description: string;
  published_at: string | null;
  created_at: string;
}

export interface CapabilityMapItemRow {
  id: UUID;
  map_id: UUID;
  code: string;
  parent_code: string | null;
  name: string;
  description: string | null;
  level: number;
  /** Sprint U4-1 C1 — see the migration's own comment for why `item_order`, not `order` (a reserved SQL keyword). */
  item_order: number;
}

/**
 * Every published *or* draft starter map — Sprint U4-1 C6: "draft maps are
 * seedable into a model for review", not published ones only, so an
 * owner/architect can seed a fresh export (or anyone else's draft) into a
 * real model to see how it reads before deciding whether to publish it.
 * Never `deprecated` — a superseded version has nothing left to offer a
 * new seed. `atlas.seed_from_map` re-checks this same `published`/`draft`
 * allowance itself (20260906320000_seed_from_draft_map.sql) rather than
 * trusting that a caller actually used this query.
 *
 * `capability_maps` has no owner/architect-only RLS of its own (`select
 * ... using (true)`, world-readable to any authenticated user) — gating
 * "seedable" to owner/architect is this function's callers' job
 * (`CapabilityMapImportPanel.tsx`, shown only where `canEdit` already
 * holds), the same convention `listPublishedCapabilityMaps` (this
 * function's predecessor) already followed.
 *
 * S1 item 13: "picker cards alphabetical by title" — `title` primary,
 * nulls last (a row from before the title/summary migration, `title`'s own
 * doc comment above) so an untitled map doesn't jump ahead of every real
 * title by sorting first; `sector` next, purely to group any such
 * untitled rows together rather than scattering them by id; `version`
 * descending last, unchanged from before this item — the newest version
 * of the same title/sector still comes first.
 */
export async function listSeedableCapabilityMaps(supabase: Client): Promise<CapabilityMapRow[]> {
  const { data, error } = await supabase
    .from('capability_maps')
    .select('*')
    .in('status', ['published', 'draft'])
    .order('title', { ascending: true, nullsFirst: false })
    .order('sector')
    .order('version', { ascending: false });
  if (error) throw new Error(`listSeedableCapabilityMaps: ${error.message}`);
  return data as CapabilityMapRow[];
}

export async function getCapabilityMap(supabase: Client, mapId: UUID): Promise<CapabilityMapRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('capability_maps').select('*').eq('id', mapId).maybeSingle();
  if (error) throw new Error(`getCapabilityMap: ${error.message}`);
  return data as CapabilityMapRow | null;
}

export async function listCapabilityMapItems(supabase: Client, mapId: UUID): Promise<CapabilityMapItemRow[]> {
  const { data, error } = await supabase.from('capability_map_items').select('*').eq('map_id', mapId).order('level');
  if (error) throw new Error(`listCapabilityMapItems: ${error.message}`);
  return data as CapabilityMapItemRow[];
}

/** F6 (ADR-023, SPEC §3.10): a starter map's value stream (`parent_code` null) or one of its stages (`parent_code` = the stream's code) — `20260921070000_value_streams.sql`. */
export interface CapabilityMapValueStreamItemRow {
  id: UUID;
  map_id: UUID;
  code: string;
  parent_code: string | null;
  name: string;
  description: string | null;
  /** Same `item_order`-not-`order` reasoning as `CapabilityMapItemRow`. */
  item_order: number;
}

/** F6: "this capability enables this stage" in a starter map — `capability_code` already resolved from the content file's capability *name* by `scripts/loadCapabilityMaps.ts`. */
export interface CapabilityMapValueStreamEnablesRow {
  map_id: UUID;
  stage_code: string;
  capability_code: string;
}

/** Streams first (a null `parent_code` sorts first under `nullsFirst`), then stages — the same parent-before-child order `listCapabilityMapItems`'s `order('level')` gives, for the same reason (`buildSeedDeltas` mints ids parent-first). */
export async function listCapabilityMapValueStreamItems(supabase: Client, mapId: UUID): Promise<CapabilityMapValueStreamItemRow[]> {
  const { data, error } = await supabase
    .from('capability_map_value_stream_items')
    .select('*')
    .eq('map_id', mapId)
    .order('parent_code', { ascending: true, nullsFirst: true })
    .order('item_order');
  if (error) throw new Error(`listCapabilityMapValueStreamItems: ${error.message}`);
  return data as CapabilityMapValueStreamItemRow[];
}

export async function listCapabilityMapValueStreamEnables(supabase: Client, mapId: UUID): Promise<CapabilityMapValueStreamEnablesRow[]> {
  const { data, error } = await supabase.from('capability_map_value_stream_enables').select('*').eq('map_id', mapId).order('stage_code').order('capability_code');
  if (error) throw new Error(`listCapabilityMapValueStreamEnables: ${error.message}`);
  return data as CapabilityMapValueStreamEnablesRow[];
}
