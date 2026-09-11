/**
 * The element browse table's data (Sprint U3b: "filterable, sortable table
 * of elements by type with owner and lifecycle"). Reads the whole model's
 * elements at one commit — same "query the model scope once, filter/sort
 * client-side" shape CLAUDE.md rule 8 already establishes elsewhere
 * (src/db/landscape.ts, src/db/elementSearch.ts), not a live filter/sort
 * endpoint per keystroke.
 */
import type { ElementType, UUID } from '../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { attributesRecord } from '../ui/elements/attributesRecord';
import type { Client } from './client';
import { selectAll } from './selectAll';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';

/** Every element of every type at `commitId` — the table's full row set before any filter/sort is applied. */
export async function listAllElements(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).order('element_type').order('name').order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

/**
 * Every element's own "the owner" for this table's single Owner column,
 * keyed by the owned element's id — built from every live `owns`
 * relationship at `commitId` (only ever system/capability targets,
 * `RELATIONSHIP_TYPE_RULES`) in one query rather than one lookup per row.
 *
 * Prompt 7k item 2: a target can now have up to three owners at once (one
 * per role), but this table has one Owner column — prefers the `business`
 * role (the closest match to what "primary" used to mean) and falls back
 * to whichever other role is present when there's no business owner, same
 * preference `enrichElementMatches.ts`'s own compact owner lookup uses.
 */
export async function loadOwnersByElementId(supabase: Client, commitId: UUID, elementsById: ReadonlyMap<UUID, ElementsHeadRow>): Promise<Map<UUID, ElementsHeadRow>> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'owns')
    .order('relationship_id');
  const rows = await selectAll<RelationshipsHeadRow>(query);

  const owners = new Map<UUID, ElementsHeadRow>();
  const fallbackOwners = new Map<UUID, ElementsHeadRow>();
  for (const row of rows) {
    const owner = elementsById.get(row.from_element_id);
    if (!owner) continue;
    if (attributesRecord(row.attributes).role === 'business') {
      owners.set(row.to_element_id, owner);
    } else if (!fallbackOwners.has(row.to_element_id)) {
      fallbackOwners.set(row.to_element_id, owner);
    }
  }
  for (const [elementId, owner] of fallbackOwners) {
    if (!owners.has(elementId)) owners.set(elementId, owner);
  }
  return owners;
}

export interface BrowseRow {
  element: ElementsHeadRow;
  owner: ElementsHeadRow | null;
  /** `SystemAttributes.lifecycleStatus` — the only type that carries one; `null` for every other type. */
  lifecycleStatus: string | null;
}

export function lifecycleStatusOf(element: ElementsHeadRow): string | null {
  if (element.element_type !== 'system') return null;
  const value = attributesRecord(element.attributes).lifecycleStatus;
  return typeof value === 'string' ? value : null;
}

export const ELEMENT_TYPE_FILTER_OPTIONS: readonly (ElementType | 'all')[] = ['all', 'capability', 'system', 'container', 'component', 'actor'];
