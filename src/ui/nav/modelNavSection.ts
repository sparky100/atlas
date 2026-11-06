/**
 * Which of the persistent model nav's sections a route belongs to
 * (Sprint U3b — UI-principles §2's own navigation model). Pure string
 * matching over `location.pathname`, not react-router's own `NavLink`
 * active-matching: the zoom chain's Context/Container pages and the diff
 * page aren't literally under `/landscape` or `/versions` in the URL, but
 * they're that section's own content by the app's own zoom-chain design
 * (UI-principles §2.1) and diff/versions relationship (§6.2), so
 * highlighting the right rail item there is the honest answer, not
 * something a path-prefix match alone would produce.
 */
export type ModelNavSection = 'home' | 'capability-map' | 'landscape' | 'value-streams' | 'elements' | 'portfolio' | 'integrations' | 'roadmap' | 'reports' | 'ask' | 'changes' | 'projects' | 'decisions' | 'capture' | 'versions' | null;

/** `pathname` is everything after the model slug, e.g. `/landscape`, `/context/abc`, `` (home) — matches `App.tsx`'s own route suffixes exactly. */
export function modelNavSectionFor(modelRelativePath: string): ModelNavSection {
  const path = modelRelativePath === '' ? '/' : modelRelativePath;
  if (path === '/') return 'home';
  if (path.startsWith('/capability-map')) return 'capability-map';
  if (path.startsWith('/landscape') || path.startsWith('/context/') || path.startsWith('/container/')) return 'landscape';
  if (path.startsWith('/roadmap')) return 'roadmap';
  if (path.startsWith('/value-streams')) return 'value-streams';
  if (path === '/elements' || path.startsWith('/elements/')) return 'elements';
  if (path.startsWith('/portfolio')) return 'portfolio';
  if (path.startsWith('/integrations')) return 'integrations';
  if (path.startsWith('/ask')) return 'ask';
  // F9 step 3: the Reports hub and the reports it lists (F12: plus the gaps queue).
  if (path.startsWith('/reports') || path.startsWith('/boundary-crossings') || path.startsWith('/external-interfaces') || path.startsWith('/duplicates') || path.startsWith('/gaps')) return 'reports';
  // F9 step 2 (UI-principles §2.0): the review queue is a tab of Changes, not
  // its own nav item — its list and both detail pages light up Changes.
  if (path.startsWith('/changes') || path.startsWith('/review')) return 'changes';
  if (path.startsWith('/capture')) return 'capture';
  if (path.startsWith('/projects')) return 'projects';
  if (path.startsWith('/decisions')) return 'decisions';
  if (path.startsWith('/versions') || path.startsWith('/diff')) return 'versions';
  return null;
}
