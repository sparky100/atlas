/**
 * The browse table's rows from an already-loaded set of elements and their
 * owners — shared by `useElementBrowse.ts` and the saved-report runner
 * (`reports/useElementReportRows.ts`) so both read an element the same way:
 * a module inherits its platform's lifecycle and criticality, and only a
 * system or module carries a disposition. Pure; split out of the hook so a
 * plain `vitest run` can import it (the hook pulls in the Supabase client).
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { criticalityOf, lifecycleStatusOf, type BrowseRow } from '../../db/elementBrowse';
import { dispositionOf } from './disposition';
import { isSystemLike } from '../../contracts/elementKinds';

export function buildBrowseRows(elements: readonly ElementsHeadRow[], ownersByElementId: ReadonlyMap<UUID, ElementsHeadRow>): BrowseRow[] {
  const elementsById = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));
  return elements.map((element) => {
    const parent = element.parent_id !== null ? (elementsById.get(element.parent_id) ?? null) : null;
    return {
      element,
      owner: ownersByElementId.get(element.element_id) ?? null,
      // `parent` threaded through so a module whose own lifecycle/criticality is unset reads as its platform's, rather than blank — `lifecycleStatusOf`/`criticalityOf`'s own doc comment.
      lifecycleStatus: lifecycleStatusOf(element, parent),
      criticality: criticalityOf(element, parent),
      disposition: isSystemLike(element) ? dispositionOf(element) : null,
      parent,
    };
  });
}
