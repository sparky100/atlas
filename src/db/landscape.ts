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
 * Every Actor at this commit — the landscape canvas, structural pass's own
 * row above the top band (item 3, the C4 landscape convention), both
 * `isExternal` and internal together (`src/ui/landscape/layout.ts`'s own
 * `computeLandscapeLayout` doesn't separate them into distinct rows,
 * `LandscapeCanvas.tsx` just draws them differently). Same `selectAll`/
 * max_rows treatment as `listSystemsForLandscape` above, for the same
 * reason (SPEC §6.7).
 */
/**
 * Every Container at this commit — "platforms and modules": a platform
 * system's own children are its modules, each of which may `supports` a
 * capability directly and needs its own landscape tile. Same
 * `selectAll`/max_rows treatment as `listSystemsForLandscape` above.
 * `useLandscape.ts` filters this client-side to the containers whose
 * `parent_id` is one of the already-loaded systems with `kind: 'platform'`
 * — cheap (bounded by however many platforms exist, never a growing
 * caller-supplied id list), not a second query scoped by parent.
 */
export async function listContainersForLandscape(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('element_type', 'container')
    .order('name')
    .order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

export async function listActorsForLandscape(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('element_type', 'actor')
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
export async function listLandscapeEdges(supabase: Client, commitId: UUID, systemIds: readonly UUID[], actorIds: readonly UUID[] = []): Promise<RelationshipsHeadRow[]> {
  if (systemIds.length === 0) return [];
  return filterLandscapeEdges(await listAllLandscapeEdgeRows(supabase, commitId), systemIds, actorIds);
}

/**
 * Every `uses`/`flows_to` row at this commit, unfiltered — fetched in
 * parallel with the systems/actors lists (so before their ids are known)
 * and narrowed afterwards by `filterLandscapeEdges`. Same fetch-the-commit
 * scope-and-filter shape as `listLandscapeEdges`, split in two so the
 * request no longer has to wait for the lists it filters against.
 */
export async function listAllLandscapeEdgeRows(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .in('relationship_type', ['uses', 'flows_to'])
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/**
 * S1 item 11a: an actor can be a `uses` edge's own `from` endpoint
 * ("Ofgem uses the reporting system") — `actorIds` widens the endpoint set
 * so that edge isn't silently dropped. Still empty with no systems at all:
 * there is nothing an actor's edge could connect to that this view would draw.
 */
export function filterLandscapeEdges(rows: readonly RelationshipsHeadRow[], systemIds: readonly UUID[], actorIds: readonly UUID[] = []): RelationshipsHeadRow[] {
  if (systemIds.length === 0) return [];
  const ids = new Set([...systemIds, ...actorIds]);
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
  return filterSupportsEdgesForSystems(await listAllSupportsEdgeRows(supabase, commitId), systemIds);
}

/** Every `supports` row at this commit, unfiltered — see `listAllLandscapeEdgeRows`. */
export async function listAllSupportsEdgeRows(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'supports')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

export function filterSupportsEdgesForSystems(rows: readonly RelationshipsHeadRow[], systemIds: readonly UUID[]): RelationshipsHeadRow[] {
  if (systemIds.length === 0) return [];
  const ids = new Set(systemIds);
  return rows.filter((r) => ids.has(r.from_element_id));
}

/**
 * V2b's Inspector panel, Selection section: "owners by role" for a
 * focused system — `owns` edges pointing *at* a system, the mirror shape
 * of `listSupportsEdgesForSystems` above (which filters on `from_element_id`
 * since a system is the *source* of its own `supports` edge; here the
 * system is the *target*). Same "fetch the commit's own edges of this
 * type, narrow to the id set in memory" shape as every other query in
 * this file (CLAUDE.md rule 8) — `systemIds` can grow with the model, so
 * this never becomes an `.in()` filter.
 */
export async function listOwnsEdgesForSystems(supabase: Client, commitId: UUID, systemIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  if (systemIds.length === 0) return [];
  return filterOwnsEdgesForSystems(await listAllOwnsEdgeRows(supabase, commitId), systemIds);
}

/** Every `owns` row at this commit, unfiltered — see `listAllLandscapeEdgeRows`. */
export async function listAllOwnsEdgeRows(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'owns')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

export function filterOwnsEdgesForSystems(rows: readonly RelationshipsHeadRow[], systemIds: readonly UUID[]): RelationshipsHeadRow[] {
  if (systemIds.length === 0) return [];
  const ids = new Set(systemIds);
  return rows.filter((r) => ids.has(r.to_element_id));
}
