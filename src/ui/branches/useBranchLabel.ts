import { useEffect, useState } from 'react';
import { refParamOf, resolveBranchRef, type Ref } from '../../db/ref';
import type { UUID } from '../../contracts/delta';
import { supabase } from '../supabaseClient';

/**
 * A branch ref's own label — `title ?? name` — for the breadcrumb's
 * `Change: {title}` chip (UI-principles §2.2) and the As-is/To-be/Diff
 * control's surrounding page. `undefined` for every non-branch ref, or
 * while still loading — `refLabelOf`'s own fallback (a short id fragment)
 * covers that gap without this hook needing a loading state of its own.
 * Also returns the branch id (`main`/`tag` refs give `null`) so a page can
 * gate the selector's visibility without re-deriving it from `ref` itself.
 */
export function useBranchLabel(ref: Ref): { label: string | undefined; branchId: UUID | null } {
  const [label, setLabel] = useState<string | undefined>(undefined);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (ref.kind !== 'branch') {
      setLabel(undefined);
      return undefined;
    }
    let cancelled = false;
    resolveBranchRef(supabase, ref)
      .then((branch) => {
        if (!cancelled) setLabel(branch?.title ?? branch?.name);
      })
      .catch(() => {
        if (!cancelled) setLabel(undefined);
      });
    return () => {
      cancelled = true;
    };
    // `refParam` (stable string) is the real dependency — same pitfall/fix as every other ref-driven hook here.
  }, [refParam]);

  return { label, branchId: ref.kind === 'branch' ? ref.branchId : null };
}
