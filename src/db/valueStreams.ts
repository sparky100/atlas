/**
 * The Value streams page's own `main`/tag queries (F6/ADR-023) — same
 * materialised-projection pattern as `src/db/capabilityMap.ts`: only
 * `main`/a tag is ever rendered this way; a `change` branch's head is
 * folded in memory instead (`src/db/branchProjection.ts`,
 * `useValueStreams.ts`'s own branch path).
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import { selectAll } from './selectAll';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/** Every `value_stream` element at this commit (streams and stages both — `stagesOf`/`streamsOf` in `valueStreamRollup.ts` split them apart by `parent_id`). */
export async function listValueStreamElements(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase
    .from('elements_head')
    .select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('element_type', 'value_stream')
    .order('name')
    .order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

/** Every `enables` edge at this commit — same "fetch the whole fixed-type set, filter in memory" shape `listAllSupportsEdges`/`listAllOwnsEdges` (`src/db/modelHome.ts`/`src/db/healthFindings.ts`) already use for a relationship type that isn't scoped by a caller-supplied id list. */
export async function listAllEnablesEdges(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'enables')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}
