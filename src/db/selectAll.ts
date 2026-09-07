/**
 * Pages a postgrest-js query past `supabase/config.toml`'s `max_rows` cap
 * (1000) instead of silently truncating at it. Sprint C1-H item 1d found
 * this concretely: `listSystemsForLandscape` (src/db/landscape.ts) did a
 * plain unpaginated `.select()` against `elements_head` for a 2,000-system
 * fixture, got exactly 1,000 rows back with no error at all, and rendered
 * "1,000 systems" — a silent, wrong answer, not a failure. `max_rows` is a
 * safety cap (protects the server from one accidentally-unbounded request),
 * not a target application code should ever rely on staying under
 * (docs/SPEC-data-model.md §6.7).
 *
 * `query` must already be built with `.select(columns, { count: 'exact' })`
 * — postgrest-js only accepts the `count` option at `.select()`
 * construction time, so `selectAll` can't add it after the fact. It loops
 * `.range()` on that same query object (postgrest-js's `.range()` just
 * overwrites the offset/limit query params and returns `this`, so re-`await`ing
 * the same builder after another `.range()` call issues a fresh request each
 * time — no need to rebuild the query per page) until a page comes back
 * shorter than `pageSize`, then cross-checks the total rows collected
 * against the exact count Postgres reported on the first page. A mismatch
 * throws rather than returning a partial result — rows shifting between
 * pages (no stable order on the query) or a concurrent write racing the
 * read are the two ways that can happen, and both deserve a loud failure,
 * not a silently short list.
 *
 * The query must also carry a deterministic order over a value that's
 * unique within its filtered scope (e.g. a primary-key column, or a
 * unique-within-the-eq'd-scope column) — `.range()`-based pagination over
 * an unordered or non-uniquely-ordered query can skip or duplicate rows
 * across page boundaries. Every call site in this module was reviewed for
 * this; see each one's own comment for which column makes its order unique.
 */
export interface SelectAllResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

export interface SelectAllQuery<T> {
  range(from: number, to: number): PromiseLike<SelectAllResult<T>>;
}

export async function selectAll<T>(query: SelectAllQuery<T>, pageSize = 1000): Promise<T[]> {
  const results: T[] = [];
  let expectedCount: number | null = null;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`selectAll: ${error.message}`);
    if (offset === 0) {
      if (count == null) {
        throw new Error(
          "selectAll: the query did not request an exact count — build it with .select(columns, { count: 'exact' }) so selectAll can detect silent truncation",
        );
      }
      expectedCount = count;
    }
    const rows = data ?? [];
    results.push(...rows);
    if (rows.length < pageSize) break;
  }

  if (results.length !== expectedCount) {
    throw new Error(
      `selectAll: expected ${String(expectedCount)} rows (Postgres's own exact count from the first page) but received ${String(results.length)} — either the query lacks a stable, unique order (rows can shift between pages) or rows were added/removed mid-read`,
    );
  }

  return results;
}
