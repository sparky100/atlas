/**
 * The element page's breadcrumb segments (UI-principles §2.2: "Always
 * visible at top-left of any canvas or element page"). Each element type
 * maps onto whichever level of the zoom chain (§2.1) it's the scope of —
 * Capability → the capability map, System → its Context view, Container →
 * its Container view (scoped by its own parent system), Component → its
 * Component view (scoped by its own parent container) — with `parent`
 * contributing one extra segment where the element page already has it
 * loaded (System, for a Container; Container, for a Component), never an
 * extra fetch just for the breadcrumb. An Actor has no view of its own in
 * the chain, so it gets no segment beyond `[ref]`.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';

export function elementBreadcrumbSegments(element: ElementsHeadRow, parent: ElementsHeadRow | null, orgSlug: string, modelSlug: string, refParam: string): BreadcrumbSegment[] {
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const query = `?ref=${refParam}`;

  switch (element.element_type) {
    case 'capability':
      return [{ label: element.name, href: `${base}/capability-map${query}` }];
    case 'system':
      return [{ label: element.name, href: `${base}/context/${element.element_id}${query}` }];
    case 'container': {
      const segments: BreadcrumbSegment[] = [];
      if (parent) segments.push({ label: parent.name, href: `${base}/context/${parent.element_id}${query}` });
      segments.push({ label: element.name, href: `${base}/container/${parent?.element_id ?? ''}${query}` });
      return segments;
    }
    case 'component': {
      const segments: BreadcrumbSegment[] = [];
      if (parent) segments.push({ label: parent.name, href: `${base}/container/${parent.parent_id ?? ''}${query}` });
      segments.push({ label: element.name, href: `${base}/component/${parent?.element_id ?? ''}${query}` });
      return segments;
    }
    case 'actor':
      return [];
  }
}
