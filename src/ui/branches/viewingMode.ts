/**
 * S1 item 2 ("View this change"): whether the current page was reached as
 * a read-only *viewing* ref rather than the session's editing ref — the
 * one bit every model-scoped page needs to fold into its own `canEdit`
 * and to pick `ViewingBranchBanner` over `EditingBranchBanner`. Read
 * straight off `?viewing=1` in the URL, never off `useSelectedRef()`:
 * that hook's `ref` is *also* the branch being viewed (a URL-explicit
 * `?ref=branch:x` always wins there, whatever the reason it's there —
 * `SelectedRefProvider.tsx`'s own module comment), so viewing needs no
 * second ref concept, only this one extra flag distinguishing "this is
 * the session's own change" from "this is just what I'm looking at."
 */
export function isViewingMode(searchParams: URLSearchParams): boolean {
  return searchParams.get('viewing') === '1';
}
