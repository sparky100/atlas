import { useEffect, useState } from 'react';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { getElementHead } from '../../db/elements';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { supabase } from '../supabaseClient';

/**
 * Resolves an element id to its current row, purely for a breadcrumb
 * segment's label — `null` while loading, absent, or not found (a stale
 * link to a since-retracted element shouldn't break the page it points
 * into, just omit that one segment). Used for the `?capability=` zoom
 * param (src/ui/nav/zoomParams.ts) and, on the Component page, the
 * system a container's own `parent_id` names — same "resolve one extra
 * element for a breadcrumb label" shape either way.
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
export function useBreadcrumbElement(modelId: UUID | null, ref: Ref, elementId: UUID | null): ElementsHeadRow | null {
  const [element, setElement] = useState<ElementsHeadRow | null>(null);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!elementId || !modelId) {
      setElement(null);
      return undefined;
    }
    let cancelled = false;
    resolveRef(supabase, modelId, ref)
      .then((commitId) => (commitId ? getElementHead(supabase, commitId, elementId) : null))
      .then((row) => {
        if (!cancelled) setElement(row);
      })
      .catch(() => {
        if (!cancelled) setElement(null);
      });
    return () => {
      cancelled = true;
    };
    // `refParam` (a stable string) is the real dependency — same pitfall/fix as every other view hook here.
  }, [modelId, refParam, elementId]);

  return element;
}
