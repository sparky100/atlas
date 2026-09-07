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
import { selectAll } from './selectAll';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/**
 * Every System at this commit — the landscape's nodes. Sprint C1-H item 1d
 * (SPEC §6.7): this is the query that first exposed `max_rows`
 * (`supabase/config.toml`, 1000) silently truncating a large result — a
 * 2,000-system fixture rendered exactly 1,000 systems with no error at all.
 * Routed through `selectAll` now, ordered by `element_id` in addition to
 * `name` so pagination has a stable, unique order (two systems can share a
 * name; `(commit_id, element_id)` is this table's actual primary key, and
 * `commit_id` is already pinned by the `.eq()` above).
 */
export async function listSystemsForLandscape(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('element_type', 'system')
    .order('name')
    .order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

/**
 * `uses`/`flows_to` relationships between two Systems — the landscape's
 * edges. Sprint C1-H item 1d (SPEC §6.7): this used to add
 * `.in('from_element_id', systemIds).in('to_element_id', systemIds)` on top
 * of the commit/type scoping, which put every system id in the model
 * straight into the request URL — landscape-perf.spec.ts's 2,000-system
 * fixture turned that into a ~70KB+ GET request a proxy/server rejects
 * outright (400s, `net::ERR_FAILED`), not a slow query. Fetching every
 * `uses`/`flows_to` edge at this commit and narrowing to `systemIds` in
 * memory instead fetches the same order of magnitude of rows (a commit's
 * whole edge set either way, `capabilityId`'s filter notwithstanding) with
 * no id ever crossing the wire in the request itself.
 *
 * Also routed through `selectAll` (SPEC §6.7's other read-at-scale rule,
 * added alongside this one): "the same order of magnitude of rows either
 * way" means this can just as easily exceed `max_rows` (1000) as the old
 * `.in()`-filtered query could exceed the URL-size limit. Ordered by
 * `relationship_id` — `commit_id` is already pinned by the `.eq()` above, so
 * `(commit_id, relationship_id)` (this table's primary key) makes that a
 * unique, stable pagination order.
 */
export async function listLandscapeEdges(supabase: Client, commitId: UUID, systemIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (systemIds.length === 0) return [];
  const ids = new Set(systemIds);
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .in('relationship_type', ['uses', 'flows_to'])
    .order('relationship_id');
  const rows = await selectAll<RelationshipsHeadRow>(query);
  return rows.filter((r) => ids.has(r.from_element_id) && ids.has(r.to_element_id));
}

/**
 * `supports` relationships from a System to whichever Capability it
 * supports — the swim-lane assignment (§6.1: "grouped into swim-lanes by
 * the capability they support"). A System that supports more than one
 * Capability is a real, allowed shape (SPEC has no cardinality limit on
 * `supports`, unlike `owns`'s single-primary-owner rule) but a swim lane is
 * a single bucket — src/ui/landscape/layout.ts picks one deterministically
 * rather than this query silently returning "the" lane per system.
 *
 * Same Sprint C1-H item 1d rewrite as `listLandscapeEdges` above, and for
 * the identical reason: fetch every `supports` edge at this commit, narrow
 * to `systemIds` in memory, rather than putting the id list in the request.
 * Same `selectAll`/order-by-`relationship_id` treatment too.
 */
export async function listSupportsEdgesForSystems(supabase: Client, commitId: UUID, systemIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (systemIds.length === 0) return [];
  const ids = new Set(systemIds);
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'supports')
    .order('relationship_id');
  const rows = await selectAll<RelationshipsHeadRow>(query);
  return rows.filter((r) => ids.has(r.from_element_id));
}
