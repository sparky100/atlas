import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { parseRefParam, refParamOf, type Ref } from '../../db/ref';
import { SelectedRefContext } from './selectedRefContext';

const MODEL_PATH_RE = /^\/o\/([^/]+)\/m\/([^/]+)/;

/** `sessionStorage` key for one model's selected ref, keyed by the org/model slugs already in the URL — no round trip to resolve a real `modelId` needed just to remember a selection. `null` off any model-scoped route (nothing to persist there). */
function storageKeyFor(pathname: string): string | null {
  const match = MODEL_PATH_RE.exec(pathname);
  if (!match) return null;
  const [, orgSlug, modelSlug] = match;
  if (!orgSlug || !modelSlug) return null;
  return `atlas.selectedRef.${orgSlug}.${modelSlug}`;
}

function readStored(storageKey: string): Ref {
  try {
    const stored = sessionStorage.getItem(storageKey);
    return stored ? parseRefParam(stored) : { kind: 'main' };
  } catch {
    // Private browsing, quota, or a disabled storage API — the ref still
    // works for this one page load via the URL/render-derived value
    // below; it just won't survive a reload or a link that drops `?ref=`.
    return { kind: 'main' };
  }
}

function writeStored(storageKey: string, ref: Ref): void {
  try {
    if (ref.kind === 'main') sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, refParamOf(ref));
  } catch {
    // best-effort only — see readStored's own comment.
  }
}

/**
 * Bug fix: "selecting a change does not persist across navigation;
 * creating an element after opening a change writes to main." Every
 * model-scoped page used to parse `?ref=` straight out of its own
 * `useSearchParams()` — correct as far as it went, but nothing kept that
 * value alive once a link dropped it: `ModelNav.tsx`'s own Home/Changes/
 * Review items never carried it forward (a former `carriesRef: false`),
 * and any other in-app link built without a `?ref=` did the same. The
 * moment the URL lost it, every page's own parse silently fell back to
 * `main` — the bug's own "creating an element after opening a change
 * writes to main" is exactly that: the search box and create paths were
 * already ref-aware (`HomeSearch.tsx`'s own "decision 5" comment), they
 * just never received anything but `main` once the URL had dropped it on
 * the way to Home.
 *
 * Fix: the selected ref becomes real session state, one per model,
 * `sessionStorage`-backed (survives a reload, per this bug's own
 * "Reloading a page keeps the selection" — plain React state alone would
 * not) and keyed by the org/model slugs already in the URL path (no
 * `modelId` resolution needed just to remember a choice). Every model-
 * scoped page now reads `useSelectedRef()` instead of re-parsing `?ref=`
 * itself.
 *
 * `ref` is derived, not stored as its own `useState` — purely a function
 * of the current URL's `?ref=` and (when the URL is silent) this
 * storage, recomputed every render; the one `useEffect` below only ever
 * performs the side effects (writing storage, rewriting a silent URL),
 * never a redundant `setState` a derived value would make circular.
 *
 * Reconciliation, on every navigation:
 * - The URL explicitly names a ref (`?ref=branch:…`, or `?ref=main`/no
 *   `ref` key immediately after "Back to main") — that value wins and
 *   becomes this session's stored choice for this model. This is how
 *   selecting a change, or explicitly returning to main, updates the
 *   session-wide selection.
 * - The URL is silent (no `ref` key at all — every link this bug report
 *   names: the nav rail's Home/Changes/Review items, the breadcrumb,
 *   search results, "→" links, and any route that never carried one to
 *   begin with) — this session's stored choice for this model is
 *   substituted in for `ref` on this very render (no flash back to
 *   main), and the URL is rewritten in place (`replace: true`, no new
 *   history entry) so the selection is genuinely "reflected in every
 *   route's URL," not just held invisibly in memory.
 *
 * Mounted once, wrapping every route (`App.tsx`, inside `BrowserRouter`
 * so `useLocation`/`useSearchParams` resolve, outside `Routes` so it
 * survives navigating between routes without remounting) — not per page,
 * so a page never needs its own copy of this reconciliation.
 */
export function SelectedRefProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const storageKey = storageKeyFor(location.pathname);
  const urlRefParam = searchParams.get('ref');

  const ref = useMemo<Ref>(() => {
    if (urlRefParam !== null) return parseRefParam(urlRefParam);
    return storageKey ? readStored(storageKey) : { kind: 'main' };
  }, [urlRefParam, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (urlRefParam !== null) {
      writeStored(storageKey, parseRefParam(urlRefParam));
      return;
    }
    const stored = readStored(storageKey);
    if (stored.kind !== 'main') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('ref', refParamOf(stored));
          return next;
        },
        { replace: true },
      );
    }
  }, [storageKey, urlRefParam, setSearchParams]);

  const setRef = useCallback(
    (next: Ref) => {
      if (storageKey) writeStored(storageKey, next);
      setSearchParams((prev) => {
        const updated = new URLSearchParams(prev);
        if (next.kind === 'main') {
          updated.delete('ref');
          // Meaningless once back at main — the As-is/To-be/Diff control
          // itself is hidden there (UI-principles §6.2), so a stale
          // `?mode=diff` left behind would be inert clutter, not a real
          // state. Cleared in the same update as `ref` (not a second,
          // separate `setSearchParams` call from a caller like
          // `EditingBranchBanner`) — `setSearchParams`'s updater closes
          // over a snapshot from its own last render, so two independent
          // calls in the same handler can each overwrite the other's
          // change instead of composing; one atomic update here is what
          // "Back to main" actually needs to land correctly.
          updated.delete('mode');
        } else {
          updated.set('ref', refParamOf(next));
        }
        return updated;
      });
    },
    [storageKey, setSearchParams],
  );

  const clearRef = useCallback(() => {
    setRef({ kind: 'main' });
  }, [setRef]);

  const value = useMemo(() => ({ ref, setRef, clearRef }), [ref, setRef, clearRef]);

  return <SelectedRefContext.Provider value={value}>{children}</SelectedRefContext.Provider>;
}
