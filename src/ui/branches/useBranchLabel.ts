import { useEffect, useState } from 'react';
import { getCommitTitles } from '../../db/modelHome';
import { refParamOf, resolveBranchRef, type Ref } from '../../db/ref';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/**
 * A ref's own display label — a branch's `title ?? name` for a `branch:`
 * ref, a commit's own `title` for a `commit:` ref (`db/modelHome.ts`'s
 * `getCommitTitles` — the same lookup `useVersionDiff.ts` already does for
 * the diff page itself). `undefined` for `main`/`tag` (nothing to resolve —
 * `refLabelOf` already renders those directly) or while still loading —
 * `refLabelOf`'s own fallback (a short id fragment) covers that gap
 * without this hook needing a loading state of its own.
 *
 * The `commit:` case exists because `VersionDiffView.tsx`'s own "each
 * changed element links at that same commit" (`elementHref`) is a real,
 * reachable path into `ElementPage.tsx` with a `commit:` ref — found the
 * same way the diff page's own heading was: a reader clicking through from
 * a diff landed on a breadcrumb reading "commit 35a1b90f," just one click
 * further from the fix than the diff page itself.
 *
 * Also returns the branch id (`main`/`tag`/`commit` refs give `null`) so a
 * page can gate the As-is/To-be/Diff selector's visibility without
 * re-deriving it from `ref` itself.
 */
export function useBranchLabel(ref: Ref): { label: string | undefined; branchId: UUID | null } {
  const [label, setLabel] = useState<string | undefined>(undefined);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (ref.kind !== 'branch' && ref.kind !== 'commit') {
      setLabel(undefined);
      return undefined;
    }
    let cancelled = false;
    const load =
      ref.kind === 'branch'
        ? resolveBranchRef(supabase, ref).then((branch) => branch?.title ?? branch?.name)
        : getCommitTitles(supabase, [ref.commitId]).then((titles) => titles.get(ref.commitId));
    load
      .then((resolved) => {
        if (!cancelled) setLabel(resolved);
      })
      .catch((e: unknown) => {
        // S1 audit follow-up: still reported (console detail) even though
        // the local fallback (`refLabelOf`'s own short-id-fragment default)
        // stays deliberately silent — same shape `useBreadcrumbElement.ts`
        // already established for item 15.
        reportError("Couldn't load this ref's label.", e);
        if (!cancelled) setLabel(undefined);
      });
    return () => {
      cancelled = true;
    };
    // `refParam` (stable string) is the real dependency — same pitfall/fix as every other ref-driven hook here.
  }, [refParam]);

  return { label, branchId: ref.kind === 'branch' ? ref.branchId : null };
}
