/**
 * F9 step 5 (UI-principles §2.0): matching for the search dialog's Changes
 * and Decisions groups — elements reuse `src/db/elementSearch.ts`'s own
 * ranked matching (via `useHomeSearch`). Pure, so ranking is checkable
 * without a database: case-insensitive, whitespace-trimmed; a title that
 * starts with the query ranks above one that only contains it; ties keep
 * the input order (callers pass newest first). Every searchable string of
 * an item counts — a change's title and its short name, for instance.
 */
export interface Searchable {
  /** The strings this item can be found by — the first is the one shown. */
  texts: readonly string[];
}

export function matchTitled<T extends Searchable>(items: readonly T[], query: string, limit = 5): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const ranked: { item: T; rank: number; index: number }[] = [];
  items.forEach((item, index) => {
    let best = Infinity;
    for (const text of item.texts) {
      const t = text.toLowerCase();
      if (t.startsWith(q)) best = Math.min(best, 0);
      else if (t.includes(q)) best = Math.min(best, 1);
    }
    if (best !== Infinity) ranked.push({ item, rank: best, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.slice(0, limit).map((entry) => entry.item);
}
