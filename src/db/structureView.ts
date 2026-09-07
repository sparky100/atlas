/**
 * The Container and Component views' shared query (UI-principles.md §6.1):
 * both are "one parent, its immediate children, plus whichever
 * external elements those children `uses`/`flows_to`" — Container scoped to
 * one System (children: containers), Component scoped to one Container
 * (children: components). `listChildrenOf` (src/db/elements.ts) already
 * covers "immediate children of a parent" generically; the one query these
 * two views need that nothing else in this codebase does yet is
 * "relationships touching *any* of a set of subjects, from either side" —
 * `listLandscapeEdges` (src/db/landscape.ts) deliberately requires *both*
 * endpoints in its set (a landscape only ever draws edges between its own
 * nodes), which is exactly wrong here: a container/component view's whole
 * point is to also surface the *external* endpoint of an edge that leaves
 * the frame.
 */
import type { RelationshipsHeadRow } from '../contracts/rows';
import type { RelationshipType, UUID } from '../contracts/delta';
import type { Client } from './client';
import { selectAll } from './selectAll';

const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/**
 * Relationships of the given types where *either* endpoint is in
 * `subjectIds` — unlike `listLandscapeEdges`'s both-endpoints-in-set query,
 * this is the one a framed view needs: it returns both the internal
 * (child-to-child) edges and the ones that cross the frame boundary, so the
 * caller can tell which is which by checking each endpoint against
 * `subjectIds` itself (src/ui/structureView/structureGrouping.ts does
 * exactly that).
 *
 * Routed through `selectAll` (SPEC §6.7), ordered by `relationship_id` for
 * a stable, unique pagination order. NOTE: the `.or(...in.(...))` filter
 * below still puts `subjectIds` directly in the request URL, same as the
 * `.in()` shape SPEC §6.7's other rule (`src/db/inFilterLimit.ts`) guards
 * against — this call site was not in Sprint C1-H item 1d's scope (that
 * item was the row-truncation half of §6.7, not the URL-size half) and is
 * not guarded by `assertInFilterSize` today. Flagged, not fixed, here.
 */
export async function listRelationshipsTouchingAny(supabase: Client, commitId: UUID, subjectIds: readonly UUID[], relationshipTypes: readonly RelationshipType[]): Promise<RelationshipsHeadRow[]> {
  if (subjectIds.length === 0) return [];
  const idList = subjectIds.join(',');
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .in('relationship_type', relationshipTypes)
    .or(`from_element_id.in.(${idList}),to_element_id.in.(${idList})`)
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}
