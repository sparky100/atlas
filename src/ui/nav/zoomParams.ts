/**
 * The zoom chain's URL state (UI-principles §2.1/§2.4): every step from
 * capability map through landscape/context/container/component carries the
 * ref and, once it exists, which capability the user zoomed in from — so a
 * link three levels deep is still a real, paste-able URL that reconstructs
 * the whole breadcrumb (§2.4's "any element, at any level, in any version,
 * has a URL"), not just the ref.
 *
 * `capability` is optional and one-way down the chain only: a director who
 * opens the landscape directly (no capability filter) sees no Capability
 * breadcrumb segment, and neither does anything they zoom into from there
 * — there's nothing to carry forward. Reaching Context/Container/Component
 * from *within* a filtered landscape (or, later, jumping there directly)
 * both leave a real Capability segment, because both cases genuinely carry
 * the same id forward through this one query param.
 */
import type { UUID } from '../../contracts/delta';
import { refParamOf, type Ref } from '../../db/ref';

export interface ZoomParams {
  ref: Ref;
  /** The capability this navigation descended from, if any — carried forward so a deep-linked Context/Container/Component page can still render the Capability breadcrumb segment. */
  capabilityId: UUID | null;
  /** S1 item 2: whether `ref` is a read-only viewing ref, not the editing one — carried the same way `capabilityId` is, so "View this change" stays in effect all the way down the zoom chain (Landscape → Context → Container → Component), not just its first hop. Omitted (falsy) for every existing caller that predates viewing mode. */
  viewing?: boolean;
}

export function zoomQueryString(params: ZoomParams): string {
  const search = new URLSearchParams({ ref: refParamOf(params.ref) });
  if (params.capabilityId) search.set('capability', params.capabilityId);
  if (params.viewing && params.ref.kind === 'branch') search.set('viewing', '1');
  return search.toString();
}

export function parseCapabilityParam(raw: string | undefined | null): UUID | null {
  return raw && raw.length > 0 ? raw : null;
}
