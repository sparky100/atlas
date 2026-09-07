/**
 * Search-first "Add" (Blocking: element creation): before creating a
 * system/actor/container/component, show what already matches so a real
 * duplicate is never created by accident. Scoped to `elementType` and the
 * given commit's head — CLAUDE.md rule 8's own reference shape
 * (src/db/landscape.ts's `listLandscapeEdges`/`listSupportsEdgesForSystems`):
 * query the model/commit scope once via `selectAll`, then filter client-side,
 * rather than an `.ilike()` endpoint per keystroke. A model's element count
 * of one type is bounded by the model itself, not by user input, so this is
 * the same shape as `listSystemsForLandscape` — not a candidate for the
 * `.in()` ceiling `assertInFilterSize` guards against.
 *
 * Search always reads main's real materialised head — not a change branch's
 * unmaterialised projection (SPEC §1 S-2) — regardless of which ref/branch
 * the page creating the element is currently viewing. This is deliberate:
 * search-first exists to catch "this already exists in the model," and the
 * model, for that purpose, is main — a change branch's own not-yet-merged
 * additions aren't a second copy of the canonical answer to "does this
 * exist," they're a proposal on top of it. Where the new element's commit
 * actually lands (main, or the branch being edited) is a separate question,
 * answered by the caller's own branch/role resolution (`useEditingBranch`/
 * `canEditBranch`), not by this module.
 */
import type { ElementType, UUID } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import type { Client } from './client';
import { selectAll } from './selectAll';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';

export interface SearchPoolElement {
  element: ElementsHeadRow;
  /** This element's own non-merged aliases (SPEC §3.6) — model-scoped, not commit-scoped, same as `listAliasesForElement`. */
  aliases: string[];
}

/**
 * Every live element of `elementType` at `commitId`, each paired with its
 * own aliases — the pool `matchElements` searches against. Loaded once per
 * (commitId, elementType) by the caller, not per keystroke.
 */
export async function loadSearchPool(supabase: Client, commitId: UUID, modelId: UUID, elementType: ElementType): Promise<SearchPoolElement[]> {
  const elementsQuery = supabase
    .from('elements_head')
    .select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('element_type', elementType)
    .order('name')
    .order('element_id');
  // Aliases are fetched for the whole model, not filtered to this pool's ids
  // (an `.in()` with a model's full element count would risk the ceiling
  // assertInFilterSize enforces) — the same "query the scope once, filter
  // client-side" shape as the elements query above.
  const aliasesQuery = supabase.from('aliases').select('element_id, alias_value', { count: 'exact' }).eq('model_id', modelId).neq('alias_type', 'merged_id').order('id');

  const [elements, aliasRows] = await Promise.all([
    selectAll<ElementsHeadRow>(elementsQuery),
    selectAll<{ element_id: UUID; alias_value: string }>(aliasesQuery),
  ]);

  const aliasesByElement = new Map<UUID, string[]>();
  for (const row of aliasRows) {
    const existing = aliasesByElement.get(row.element_id);
    if (existing) existing.push(row.alias_value);
    else aliasesByElement.set(row.element_id, [row.alias_value]);
  }

  return elements.map((element) => ({ element, aliases: aliasesByElement.get(element.element_id) ?? [] }));
}

/** Same as `loadSearchPool`, unioned across every type in `elementTypes` — a relationship's target type isn't always singular (`RELATIONSHIP_TYPE_RULES`: e.g. a container `uses` either another container or a system), so the relationship "Add" picker searches every type its group actually allows. */
export async function loadSearchPoolForTypes(supabase: Client, commitId: UUID, modelId: UUID, elementTypes: readonly ElementType[]): Promise<SearchPoolElement[]> {
  const pools = await Promise.all(elementTypes.map((elementType) => loadSearchPool(supabase, commitId, modelId, elementType)));
  return pools.flat();
}

function descriptionOf(element: ElementsHeadRow): string {
  const value: unknown = (element.attributes as Record<string, unknown> | null)?.description;
  return typeof value === 'string' ? value : '';
}

/**
 * Pure matching (Blocking: element creation's "matches against names,
 * aliases and descriptions"): case-insensitive substring, name first, then
 * description, then alias — checked in that order only to short-circuit,
 * not to rank (`limit` caps the result list for a typeahead-sized display,
 * not a relevance sort). An empty/whitespace-only query matches nothing —
 * there's no "everything" state for this control, only "type to search."
 */
export function matchElements(pool: readonly SearchPoolElement[], query: string, limit = 8): ElementsHeadRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const matches: ElementsHeadRow[] = [];
  for (const { element, aliases } of pool) {
    if (matches.length >= limit) break;
    const nameMatch = element.name.toLowerCase().includes(q);
    const descriptionMatch = !nameMatch && descriptionOf(element).toLowerCase().includes(q);
    const aliasMatch = !nameMatch && !descriptionMatch && aliases.some((alias) => alias.toLowerCase().includes(q));
    if (nameMatch || descriptionMatch || aliasMatch) matches.push(element);
  }
  return matches;
}
