/**
 * The landscape view's own query (UI-principles.md §6.1): systems, grouped
 * into swim-lanes by the capability they `support`, with `uses`/`flows_to`
 * edges between them. Reads straight off `elements_head`/`relationships_head`
 * at a resolved commit — same materialised-projection pattern as
 * src/db/elements.ts, and the same Sprint U1 scope note applies: only
 * `main`/a tag is ever rendered (ADR-015), never an arbitrary branch commit.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/** Every System at this commit — the landscape's nodes. */
export async function listSystemsForLandscape(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const { data, error } = await supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS).eq('commit_id', commitId).eq('element_type', 'system').order('name');
  if (error) throw new Error(`listSystemsForLandscape: ${error.message}`);
  return data;
}

/**
 * `uses`/`flows_to` relationships between two Systems — the landscape's
 * edges. Chaining `.in()` twice ANDs the two clauses (postgrest-js's default
 * combinator across separate filter calls), so this asks for exactly "both
 * endpoints are in `systemIds`," not "either endpoint is."
 */
export async function listLandscapeEdges(supabase: Client, commitId: UUID, systemIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (systemIds.length === 0) return [];
  const { data, error } = await supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS)
    .eq('commit_id', commitId)
    .in('relationship_type', ['uses', 'flows_to'])
    .in('from_element_id', systemIds)
    .in('to_element_id', systemIds);
  if (error) throw new Error(`listLandscapeEdges: ${error.message}`);
  return data;
}

/**
 * `supports` relationships from a System to whichever Capability it
 * supports — the swim-lane assignment (§6.1: "grouped into swim-lanes by
 * the capability they support"). A System that supports more than one
 * Capability is a real, allowed shape (SPEC has no cardinality limit on
 * `supports`, unlike `owns`'s single-primary-owner rule) but a swim lane is
 * a single bucket — src/ui/landscape/layout.ts picks one deterministically
 * rather than this query silently returning "the" lane per system.
 */
export async function listSupportsEdgesForSystems(supabase: Client, commitId: UUID, systemIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (systemIds.length === 0) return [];
  const { data, error } = await supabase.from('relationships_head').select(RELATIONSHIPS_HEAD_COLUMNS).eq('commit_id', commitId).eq('relationship_type', 'supports').in('from_element_id', systemIds);
  if (error) throw new Error(`listSupportsEdgesForSystems: ${error.message}`);
  return data;
}
