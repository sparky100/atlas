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
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/** Every element of every type at `commitId` — the table's full row set before any filter/sort is applied. */
export async function listAllElements(supabase: Client, commitId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).order('element_type').order('name').order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

/**
 * Every live `owns` relationship at `commitId` — the raw edges
 * `ownersByElementIdFromOwnsEdges` below turns into "the owner" per target.
 * Split out from `loadOwnersByElementId` so a caller that already has its
 * own owning-actor lookup (Sprint U4-2c item 2's `useCapabilityLandscape`,
 * whose systems come from a branch projection already holding this exact
 * array, `HeadProjection.relationshipsHead`) can reuse the same preference
 * logic without a second identical query.
 */
export async function listOwnsEdges(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase.from('relationships_head').select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).eq('relationship_type', 'owns').order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/**
 * "The owner" per target, keyed by the owned element's id, from an already-
 * fetched set of `owns` edges (`listOwnsEdges` above, or a branch
 * projection's own `relationshipsHead` filtered to `relationship_type ===
 * 'owns'`) — the pure half of `loadOwnersByElementId`.
 *
 * Prompt 7k item 2: a target can now have up to three owners at once (one
 * per role), but this is a single-Owner lookup — prefers the `business`
 * role (the closest match to what "primary" used to mean) and falls back
 * to whichever other role is present when there's no business owner, same
 * preference `enrichElementMatches.ts`'s own compact owner lookup uses.
 */
export function ownersByElementIdFromOwnsEdges(ownsEdges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): Map<UUID, ElementsHeadRow> {
  const owners = new Map<UUID, ElementsHeadRow>();
  const fallbackOwners = new Map<UUID, ElementsHeadRow>();
  for (const row of ownsEdges) {
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

/**
 * Every element's own "the owner" for this table's single Owner column —
 * `listOwnsEdges` plus `ownersByElementIdFromOwnsEdges` in one call, kept
 * for this file's own existing caller (`useElementBrowse.ts`, which already
 * has the whole model's `elementsById` loaded for the table itself).
 */
export async function loadOwnersByElementId(supabase: Client, commitId: UUID, elementsById: ReadonlyMap<UUID, ElementsHeadRow>): Promise<Map<UUID, ElementsHeadRow>> {
  const ownsEdges = await listOwnsEdges(supabase, commitId);
  return ownersByElementIdFromOwnsEdges(ownsEdges, elementsById);
}

export interface BrowseRow {
  element: ElementsHeadRow;
  owner: ElementsHeadRow | null;
  /** `SystemAttributes.lifecycleStatus` — the only type that carries one; `null` for every other type. */
  lifecycleStatus: string | null;
  /** `SystemAttributes.criticality` — the element's own value, same "system-only, no module inheritance" scope as `lifecycleStatus` above (`moduleAttributes.ts`'s inheritance is deliberately not applied here, matching `lifecycleStatusOf`'s own precedent). `null` for every other type or an unset value. */
  criticality: string | null;
  /** `element`'s own parent, for `moduleDisplayName`'s "Platform · Module" convention — the whole model's elements are already loaded for this table (`useElementBrowse.ts`), so this is a free Map lookup, never a second query. `null` for every element without a parent. */
  parent: ElementsHeadRow | null;
}

export function lifecycleStatusOf(element: ElementsHeadRow): string | null {
  if (element.element_type !== 'system') return null;
  const value = attributesRecord(element.attributes).lifecycleStatus;
  return typeof value === 'string' ? value : null;
}

export function criticalityOf(element: ElementsHeadRow): string | null {
  if (element.element_type !== 'system') return null;
  const value = attributesRecord(element.attributes).criticality;
  return typeof value === 'string' ? value : null;
}

export const ELEMENT_TYPE_FILTER_OPTIONS: readonly (ElementType | 'all')[] = ['all', 'capability', 'system', 'container', 'actor', 'value_stream'];

/**
 * Health findings (`useElementBrowse.ts`'s own `ElementBrowseFilter` named
 * variants) as a pickable toolbar dropdown — previously reachable only as a
 * `?filter=` deep link from `ArchitectHome.tsx`'s own Health findings panel.
 * Labels are a shortened form of that panel's own `summary` strings, one per
 * `ElementsPage.tsx`'s own `VALID_FILTERS`. `''` is "no finding filter",
 * matching `ElementBrowseCustomAttrSelection`'s own "unset" convention.
 */
export const FINDING_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All findings' },
  { value: 'unlinked-systems', label: 'Systems not linked to a capability' },
  { value: 'platform-supports-move-to-module', label: 'Platform supports that could move to a module' },
  { value: 'unowned-capabilities', label: 'Capabilities with no owner' },
  { value: 'stale-attributes', label: 'Systems with stale attributes' },
  { value: 'no-technical-owner', label: 'Systems with no technical owner' },
  { value: 'critical-no-business-owner', label: 'Critical systems with no business owner' },
  { value: 'critical-exposed', label: 'Critical systems exposed with no replacement' },
  { value: 'unused-integration-platform', label: 'Unused integration platforms' },
  { value: 'essential-no-technical-owner', label: 'Essential systems with no technical owner' },
  { value: 'critical-support-end', label: 'Critical systems past or near support end' },
  { value: 'capability-no-supporters', label: 'Capabilities with no supporters' },
];
