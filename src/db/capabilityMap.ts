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
import { selectAll } from './selectAll';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/**
 * Every Capability at this commit — the map's tiles. Routed through
 * `selectAll` (SPEC §6.7) like every other unbounded `elements_head`/
 * `relationships_head` read — ordered by `element_id` in addition to `name`
 * for a stable, unique pagination order (see `listSystemsForLandscape`'s
 * identical comment, src/db/landscape.ts).
 */
export async function listCapabilitiesForMap(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('element_type', 'capability')
    .order('name')
    .order('element_id');
  return selectAll<ElementsHeadRow>(query);
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
 *
 * Sprint C1-H item 1d (SPEC §6.7): `useCapabilityMap.ts` calls this with
 * every capability in the map, which a real taxonomy can easily put past
 * the `.in()`-filter-size limit (`src/db/inFilterLimit.ts`) — a capability
 * map has no `landscape-perf.spec.ts`-sized fixture catching this today,
 * but guarding this call without also fixing it would just trade a rare
 * silent failure for a guaranteed loud one. Same rewrite as
 * `listLandscapeEdges`/`listSupportsEdgesForSystems`: fetch every
 * `supports` edge at this commit, narrow to `capabilityIds` in memory.
 */
export async function listSupportsEdgesForCapabilities(supabase: Client, commitId: UUID, capabilityIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (capabilityIds.length === 0) return [];
  const ids = new Set(capabilityIds);
  const rows = await listSupportsEdgesForAllCapabilities(supabase, commitId);
  return rows.filter((r) => ids.has(r.to_element_id));
}

/**
 * Every `supports` edge at this commit, unfiltered — for a caller that
 * fetches it in parallel with the capability list (so it can't know the
 * capability ids yet) and narrows in memory afterwards, the same
 * fetch-the-commit-scope-and-filter shape rule 8 already prescribes.
 */
export async function listSupportsEdgesForAllCapabilities(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'supports')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/**
 * Whether this commit has any System element at all — Sprint U4-1 C4's
 * "'None' only while the model has no systems". Deliberately not derived
 * from `useCapabilityMap.ts`'s own `systemsById`: that map only ever
 * holds systems with a live `supports` edge into *some* capability, so a
 * model with real, unlinked systems would read as `systemsById.size ===
 * 0` there — a different fact ("nothing's linked yet") from this one
 * ("there's nothing to link"). An exact count via `head: true` (no rows
 * returned) is the same shape `loadModelCounts` (src/db/modelHome.ts)
 * already uses for the identical "count of systems at this commit"
 * query — this only needs the boolean, not the number.
 */
export async function hasAnySystem(supabase: Client, commitId: UUID): Promise<boolean> {
  const { count, error } = await supabase.from('elements_head').select('element_id', { count: 'exact', head: true }).eq('commit_id', commitId).eq('element_type', 'system');
  if (error) throw new Error(`hasAnySystem: ${error.message}`);
  return (count ?? 0) > 0;
}
