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

/**
 * Merges several already-loaded search pools into one, ordered by name
 * (case-insensitive, the same comparison a reader would use) then element
 * id — the same tie-break `loadSearchPool`'s own `.order('name').order('element_id')`
 * query already uses within a single type. Exported so `loadSearchPoolForTypes`'s
 * own merge step is unit-testable without a database.
 *
 * Bug this fixes: a plain `pools.flat()` leaves every type's own elements
 * grouped together in the order `elementTypes` was given — every system,
 * *then* every container, never interleaved. `matchElements`'s own `limit`
 * stops at the first N matches it finds while walking the pool in order —
 * so whenever a query matches `limit` or more elements of the first type
 * alone, `matchElements` never even reaches the second type's own portion
 * of the pool, and a real, otherwise-good match (e.g. a container named
 * "PM" among the systems a broader query like "sa" already matches plenty
 * of) silently never appears, however well it matches. Sorting the merged
 * pool by name first means `limit` is applied to one alphabetical list,
 * not to one type's elements before another's.
 */
export function mergeSearchPools(pools: readonly SearchPoolElement[][]): SearchPoolElement[] {
  return pools.flat().sort((a, b) => a.element.name.localeCompare(b.element.name, undefined, { sensitivity: 'base' }) || a.element.element_id.localeCompare(b.element.element_id));
}

/** Same as `loadSearchPool`, unioned across every type in `elementTypes` — a relationship's target type isn't always singular (`RELATIONSHIP_TYPE_RULES`: e.g. a container `uses` either another container or a system), so the relationship "Add" picker searches every type its group actually allows. Merged and re-sorted by name (`mergeSearchPools`'s own doc comment explains why: never one type's elements block another's out of a capped result list). */
export async function loadSearchPoolForTypes(supabase: Client, commitId: UUID, modelId: UUID, elementTypes: readonly ElementType[]): Promise<SearchPoolElement[]> {
  const pools = await Promise.all(elementTypes.map((elementType) => loadSearchPool(supabase, commitId, modelId, elementType)));
  return mergeSearchPools(pools);
}

function descriptionOf(element: ElementsHeadRow): string {
  const value: unknown = (element.attributes as Record<string, unknown> | null)?.description;
  return typeof value === 'string' ? value : '';
}

/**
 * How well `q` (already trimmed/lowercased) matches one pool entry, lowest
 * number best — `null` for no match at all. Field priority (name, then
 * description, then alias) is preserved exactly as it always was; new here
 * is ranking *within* a field, so a name that starts with the query (a
 * system literally called "Salesforce" for a "sa" search) beats one that
 * merely contains it somewhere in the middle (a system whose *description*
 * happens to mention "SaaS") purely because it happened to load first —
 * the bug behind `matchElements` silently truncating a highly relevant
 * result out of a capped list while a poor one took its place.
 */
function matchTier(element: ElementsHeadRow, aliases: readonly string[], q: string): number | null {
  const name = element.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  const description = descriptionOf(element).toLowerCase();
  if (description.startsWith(q)) return 3;
  if (description.includes(q)) return 4;
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    if (a.startsWith(q)) return 5;
    if (a.includes(q)) return 6;
  }
  return null;
}

/**
 * Every pool entry that matches `query` at all, best match first
 * (`matchTier`'s own doc comment) — ties broken by stable sort, which
 * preserves the pool's own incoming order (for `loadSearchPoolForTypes`,
 * already alphabetical by name via `mergeSearchPools`). `excludeElementId`,
 * when given, drops one id before ranking/counting — applied here, not as
 * a post-filter on an already-capped result, so excluding an element that
 * would otherwise have filled a visible slot doesn't just shrink the
 * result list by one instead of backfilling from the next-best match
 * (`useRelationshipTargetSearch.ts`'s own reason for excluding the
 * element whose own "+ Add" this is — relating something to itself is
 * never legal). Unbounded — callers needing a capped display list or just
 * the total match count both derive from this same ranking, so the two
 * can never disagree about what counts as a match.
 */
function rankedMatches(pool: readonly SearchPoolElement[], query: string, excludeElementId?: UUID): ElementsHeadRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const ranked: { element: ElementsHeadRow; tier: number }[] = [];
  for (const { element, aliases } of pool) {
    if (excludeElementId !== undefined && element.element_id === excludeElementId) continue;
    const tier = matchTier(element, aliases, q);
    if (tier !== null) ranked.push({ element, tier });
  }
  ranked.sort((a, b) => a.tier - b.tier);
  return ranked.map((r) => r.element);
}

/**
 * Pure matching (Blocking: element creation's "matches against names,
 * aliases and descriptions"), best matches first (`matchTier`), capped at
 * `limit` for a typeahead-sized display — an empty/whitespace-only query
 * matches nothing, there's no "everything" state for this control, only
 * "type to search." Pair with `countMatches` (same ranking, unbounded) to
 * know whether this cap actually cut anything off.
 */
export function matchElements(pool: readonly SearchPoolElement[], query: string, limit = 8, excludeElementId?: UUID): ElementsHeadRow[] {
  return rankedMatches(pool, query, excludeElementId).slice(0, limit);
}

/**
 * The total number of pool entries `matchElements` would match before its
 * own `limit` truncates them — a caller shows this against the visible
 * result count so "nothing shown past position N" reads as "keep typing to
 * narrow," not "this doesn't exist yet" (the false-duplicate risk a silent
 * cap invites: `showCreate`/`hasCreatableExactMatch` only ever suppress
 * "Create…" for an *exact* match, so a real near-match sitting just past
 * the cap is invisible *and* offers no signal that clicking "Create" would
 * make a duplicate).
 */
export function countMatches(pool: readonly SearchPoolElement[], query: string, excludeElementId?: UUID): number {
  return rankedMatches(pool, query, excludeElementId).length;
}

/**
 * Prompt 7h bug fix: "the search-first create option disappears when any
 * partial match exists." The rule is "'Create...' is always the last row
 * unless there is an exact, case-insensitive match on a name or alias" —
 * a near-match (a substring `matchElements` already surfaces) should never
 * hide create, only an exact one should, since an exact match means the
 * thing being typed almost certainly already exists under that literal
 * name. Deliberately excludes description (unlike `matchElements`'s own
 * substring pass): a description matching the typed text exactly is a
 * coincidence, not evidence this is the same element.
 */
export function hasExactMatch(pool: readonly SearchPoolElement[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return false;
  return pool.some(({ element, aliases }) => element.name.toLowerCase() === q || aliases.some((alias) => alias.toLowerCase() === q));
}
