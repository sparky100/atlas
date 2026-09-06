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
 */
export function useBreadcrumbElement(modelId: UUID, ref: Ref, elementId: UUID | null): ElementsHeadRow | null {
  const [element, setElement] = useState<ElementsHeadRow | null>(null);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!elementId) {
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
