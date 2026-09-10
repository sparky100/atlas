/**
 * The empty/undefined-id-filter guard (Sprint U4-2a item 2). Found live on
 * the Landscape route: `useBreadcrumbElement`'s effect guarded on
 * `elementId` alone, not `modelId` — so a page rendering before its own
 * `model` resolved (`model?.id ?? ''`, the `?? null`-elsewhere convention's
 * one miss) called `resolveRef` → `getMainBranch(supabase, '')`, which
 * built `.eq('model_id', '')` and shipped it: `GET
 * .../branches?select=*&model_id=eq.&kind=eq.main`, a real 400 every time,
 * three times in a row on one page load.
 *
 * postgrest-js has no client-side validation of an `.eq()` value — an
 * empty string is a perfectly legal *string* to filter on, so nothing
 * stops the request from going out; Postgres (or PostgREST's own uuid
 * cast) is what finally rejects it, as a 400 with no useful stack back to
 * the call site that produced it. `assertRealId` is the enforcement
 * point: called right before an `.eq()`/`.single()`-style lookup whose
 * value is an id (never a small fixed enum like a status or kind column —
 * that's not this guard's job), it throws immediately, in-process, naming
 * the function and column that got a hollow id — instead of letting a
 * malformed request reach the network at all.
 *
 * This is a backstop, not the fix for any one call site: the real fix is
 * always to stop calling the function with a hollow id in the first place
 * (a resolved-model gate, per this item's own name) — see
 * `useBreadcrumbElement.ts`'s guard fix alongside this file.
 */
export function assertRealId(context: string, column: string, value: string | null | undefined): void {
  if (!value) {
    throw new Error(`${context}: called with an empty/undefined '${column}' id — refusing to send .eq('${column}', ${JSON.stringify(value)}) to the database. This is almost always a resolved-model/resolved-id gate missing further up, not a real query to run.`);
  }
}
