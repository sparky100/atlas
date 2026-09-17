/**
 * The element page's breadcrumb segments (UI-principles §2.2: "Always
 * visible at top-left of any canvas or element page"). Each element type
 * maps onto whichever level of the zoom chain (§2.1) it's the scope of —
 * Capability → the capability map, System → its Context view, Container →
 * its own Context view too (V3: a container is a real hub in its own
 * right now, since "component"'s removal, S1 item 18, left it structurally
 * terminal) — with `parent` contributing one extra segment naming the
 * container's own platform, where the element page already has it loaded,
 * never an extra fetch just for the breadcrumb. An Actor has no view of
 * its own in the chain, so it gets no segment beyond `[ref]`.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';

/** `refQuery` is the full `ref=...` query fragment (`refQueryParam`), not a bare token — see `CapabilityMapView.tsx`'s identical `refParam` doc comment for why (S1 item 2: carries `&viewing=1` while this element page is itself a read-only viewing ref, so zooming out from it stays read-only too). */
export function elementBreadcrumbSegments(element: ElementsHeadRow, parent: ElementsHeadRow | null, orgSlug: string, modelSlug: string, refQuery: string): BreadcrumbSegment[] {
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const query = `?${refQuery}`;

  switch (element.element_type) {
    case 'capability':
      return [{ label: element.name, href: `${base}/capability-map${query}` }];
    case 'system':
      return [{ label: element.name, href: `${base}/context/${element.element_id}${query}` }];
    case 'container': {
      const segments: BreadcrumbSegment[] = [];
      if (parent) segments.push({ label: parent.name, href: `${base}/context/${parent.element_id}${query}` });
      // V3 item 1: a container's own segment now points at its own Context
      // page, not the old `/container/:parentId` structure list — that
      // page still exists (linked from the Context view's own "Containers
      // →"), but is no longer where a container's own breadcrumb segment
      // lands.
      segments.push({ label: element.name, href: `${base}/context/${element.element_id}${query}` });
      return segments;
    }
    case 'actor':
      return [];
  }
}
