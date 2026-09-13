import { useEffect, useState } from 'react';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { getElementHead } from '../../db/elements';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/**
 * Resolves an element id to its current row, purely for a breadcrumb
 * segment's label — `null` while loading, absent, or not found (a stale
 * link to a since-retracted element shouldn't break the page it points
 * into, just omit that one segment). Used for the `?capability=` zoom
 * param (src/ui/nav/zoomParams.ts) — the Component page's own analogous
 * use (resolving the system a container's own `parent_id` named) was
 * removed along with that page, S1 item 18.
 *
 * Sprint U4-2a item 2: takes `UUID | null`, not just `UUID` — this used to
 * guard on `elementId` alone, so a caller passing `model?.id ?? ''` (every
 * call site's own convention is `?? null`; this was the one miss) fired a
 * real `resolveRef(supabase, '', ref)` on every render before the page's
 * own `model` resolved, three-for-three landing a `model_id=eq.` 400 on
 * the Landscape route, caught live via the console-open route audit this
 * item asked for. Guarding here on `modelId` too is the actual fix;
 * `assertRealId` in `resolveRef` itself is only the backstop.
 */
export function useBreadcrumbElement(
  modelId: UUID | null,
  ref: Ref,
  elementId: UUID | null,
  /** S1 item 15 (A2 remainder): the caller's own already-resolved main head commit id — same race-tolerant dedup shape `useStructureView.ts`'s own parameter comment explains. */
  mainCommitIdHint: UUID | null = null,
): ElementsHeadRow | null {
  const [element, setElement] = useState<ElementsHeadRow | null>(null);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!elementId || !modelId) {
      setElement(null);
      return undefined;
    }
    let cancelled = false;
    (ref.kind === 'main' && mainCommitIdHint ? Promise.resolve(mainCommitIdHint) : resolveRef(supabase, modelId, ref))
      .then((commitId) => (commitId ? getElementHead(supabase, commitId, elementId) : null))
      .then((row) => {
        if (!cancelled) setElement(row);
      })
      .catch((e: unknown) => {
        // S1 item 15: still reported (console detail, one shared plain
        // sentence) even though the local fallback stays deliberately
        // silent — this doc comment's own "just omit that one segment" is
        // still the right UI response, but a real fetch failure
        // shouldn't vanish with no trace anywhere.
        reportError("Couldn't load a breadcrumb segment.", e);
        if (!cancelled) setElement(null);
      });
    return () => {
      cancelled = true;
    };
    // `refParam` (a stable string) is the real dependency — same pitfall/fix as every other view hook here.
  }, [modelId, refParam, elementId, mainCommitIdHint]);

  return element;
}
