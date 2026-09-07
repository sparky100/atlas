/**
 * The As-is/To-be/Diff selector's own state (UI-principles §6.2) — a
 * `?mode=` URL param, separate from `?ref=`/`?diff=` (the general
 * arbitrary-two-refs comparator src/ui/versions/VersionDiffPage.tsx
 * already uses): a branch ref names *which* branch; `mode` names which of
 * its three lenses is showing. Meaningless for `main`/`tag` refs — the
 * control itself is hidden there (§6.2: "there is nothing to compare").
 * Lives alongside src/db/ref.ts, not under src/ui: both are URL/ref
 * grammar consumed by a db-layer resolver (this one by
 * src/db/branchProjection.ts's `resolveBranchModeProjection`), the same
 * layering `Ref`/`parseRefParam` already established.
 */
export type ViewMode = 'asIs' | 'toBe' | 'diff';

const VIEW_MODES: readonly ViewMode[] = ['asIs', 'toBe', 'diff'];

/** Defaults to `toBe` — a branch's own current state is the natural first thing to look at, same default `resolveRef` (src/db/ref.ts) uses for a bare branch ref. */
export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw !== null && raw !== undefined && (VIEW_MODES as readonly string[]).includes(raw) ? (raw as ViewMode) : 'toBe';
}
