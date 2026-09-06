/**
 * The capability map view's own query (UI-principles.md §6.1, §3.1;
 * SPEC-data-model.md §3.9's Sprint U2 amendment): the model's own
 * `capability`-typed elements, nested by `parent_id` — "structure is
 * nesting" (§6.1's Edges column: none). Same materialised-projection
 * pattern as src/db/elements.ts and src/db/landscape.ts: only `main`/a tag
 * is ever rendered (ADR-015), never an arbitrary branch commit.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/** Every Capability at this commit — the map's tiles. */
export async function listCapabilitiesForMap(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const { data, error } = await supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS).eq('commit_id', commitId).eq('element_type', 'capability').order('name');
  if (error) throw new Error(`listCapabilitiesForMap: ${error.message}`);
  return data;
}

/**
 * `supports` relationships targeting any of `capabilityIds` — the source
 * for both the tile's supporting-system count (§3.1: "a count of
 * supporting systems") and the colour-by modes (src/ui/capabilityMap/
 * metrics.ts), which both need the actual supporting systems, not just a
 * number. The mirror image of src/db/landscape.ts's
 * `listSupportsEdgesForSystems`, anchored on `to_element_id` (the
 * capability) instead of `from_element_id` (the system) — a `supports`
 * edge is directional (System → Capability, ADR-001), so these are
 * genuinely different queries, not the same one read backwards.
 */
export async function listSupportsEdgesForCapabilities(supabase: Client, commitId: UUID, capabilityIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (capabilityIds.length === 0) return [];
  const { data, error } = await supabase.from('relationships_head').select(RELATIONSHIPS_HEAD_COLUMNS).eq('commit_id', commitId).eq('relationship_type', 'supports').in('to_element_id', capabilityIds);
  if (error) throw new Error(`listSupportsEdgesForCapabilities: ${error.message}`);
  return data;
}
