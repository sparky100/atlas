/**
 * Which of the persistent model nav's six sections a route belongs to
 * (Sprint U3b — UI-principles §2's own navigation model). Pure string
 * matching over `location.pathname`, not react-router's own `NavLink`
 * active-matching: the zoom chain's Context/Container pages and the diff
 * page aren't literally under `/landscape` or `/versions` in the URL, but
 * they're that section's own content by the app's own zoom-chain design
 * (UI-principles §2.1) and diff/versions relationship (§6.2), so
 * highlighting the right rail item there is the honest answer, not
 * something a path-prefix match alone would produce.
 */
export type ModelNavSection = 'home' | 'capability-map' | 'landscape' | 'roadmap' | 'changes' | 'capture' | 'decisions' | 'versions' | 'review' | null;

/** `pathname` is everything after the model slug, e.g. `/landscape`, `/context/abc`, `` (home) — matches `App.tsx`'s own route suffixes exactly. */
export function modelNavSectionFor(modelRelativePath: string): ModelNavSection {
  const path = modelRelativePath === '' ? '/' : modelRelativePath;
  if (path === '/') return 'home';
  if (path.startsWith('/capability-map')) return 'capability-map';
  if (path.startsWith('/landscape') || path.startsWith('/context/') || path.startsWith('/container/')) return 'landscape';
  if (path.startsWith('/roadmap')) return 'roadmap';
  if (path.startsWith('/changes')) return 'changes';
  if (path.startsWith('/capture')) return 'capture';
  if (path.startsWith('/decisions')) return 'decisions';
  if (path.startsWith('/versions') || path.startsWith('/diff')) return 'versions';
  if (path.startsWith('/review')) return 'review';
  return null;
}
