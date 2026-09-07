/**
 * The `.in()`-filter-size guard (SPEC §6.7, Sprint C1-H item 1d).
 * postgrest-js sends `.in(column, values)` as a GET query parameter, so its
 * URL grows with `values.length` — a caller-supplied id list that scales
 * with model size (element/subject/source/branch/commit ids, not a small
 * fixed enum like a status or type list) can eventually produce a URL long
 * enough for a proxy or server to reject the request outright. That's
 * exactly how `landscape-perf.spec.ts` stalled at 2,000-system scale: a
 * ~70KB+ URL from `.in('from_element_id', systemIds)`, answered with 400s
 * and `net::ERR_FAILED`, never a slow response.
 *
 * `assertInFilterSize` is the enforcement point: called right before an
 * `.in()` whose value list can grow with the model, it throws rather than
 * letting the query run and hope the list stays small in practice — a call
 * site over the limit is a bug to fix (query the commit/model scope alone
 * and filter client-side instead, as `src/db/landscape.ts`'s
 * `listLandscapeEdges`/`listSupportsEdgesForSystems` now do), not a
 * pre-existing query to leave silently at risk of the same failure.
 */
export const MAX_IN_FILTER_VALUES = 50;

export function assertInFilterSize(context: string, column: string, values: readonly unknown[]): void {
  if (values.length > MAX_IN_FILTER_VALUES) {
    throw new Error(
      `${context}: .in('${column}', ...) called with ${String(values.length)} values, over the ${String(MAX_IN_FILTER_VALUES)}-value limit (SPEC §6.7) — postgrest-js sends .in() as a GET query parameter, and an unbounded id list risks a URL long enough for a proxy/server to reject the request outright. Query the commit/model scope alone and filter client-side instead.`,
    );
  }
}
