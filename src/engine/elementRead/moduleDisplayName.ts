/**
 * "Platform · Module" — the one place this naming convention is actually
 * computed. A bare module name ("PM", "FI", "RE") is ambiguous on its own
 * — the same short name recurs across different platforms — so a
 * container whose parent is a live platform system reads as
 * "{platform} · {module}" everywhere this product shows one: the
 * landscape canvas (`useLandscape.ts`), the capability-map flat list
 * (`useCapabilityLandscape.ts`, via `landscapeModules.ts`'s own
 * `withModuleLabels`), the Relationships section
 * (`relationshipEndpointLabel.ts`), every search list a container can
 * appear in (Home search, the "+ Add" element-creation control, and every
 * relationship/retire/merge target picker), the ordinary Context diagram
 * (`contextGrouping.ts`), and the integration-platform Context view plus
 * its own "Flows via this platform" section — shared verbatim with the
 * element page (`PlatformFlowsSection.tsx`, `IntegrationPlatformMobileList.tsx`,
 * `IntegrationPlatformDiagramCanvas.tsx`). One implementation, so "the
 * same convention" can never quietly drift into several slightly different
 * ones.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { isIntegrationPlatform, isPlatform } from './systemKind';

/**
 * `element`'s own display name — "{parent} · {element}" when `element` is
 * a container whose given `parent` is a live platform or integration platform system, otherwise
 * just `element.name`. Never looks anything up itself; the caller already
 * has (or knows how to resolve) `parent`, however it's scoped — an
 * endpoints map, a batched parent lookup, or a single already-fetched row.
 */
export function moduleDisplayName(element: ElementsHeadRow, parent: ElementsHeadRow | null): string {
  if (element.element_type !== 'container' || parent === null) return element.name;
  // ADR-026: an interface on an integration platform is named the same way ("MuleSoft · Reads API").
  return isPlatform(parent) || (parent.element_type === 'system' && isIntegrationPlatform(parent)) ? `${parent.name} · ${element.name}` : element.name;
}

/**
 * Every container's own `parent_id` among `elements` — the batch of ids a
 * caller needs to additionally fetch (and merge into the same `elementsById`
 * map) so `moduleDisplayNameFromMap` below can resolve every one of them. A
 * container's own parent is never itself a relationship endpoint or a
 * search-pool member the caller's own query already fetched, so this is
 * always a second, small, targeted lookup — never widened into "fetch every
 * element's parent," which no caller here actually needs.
 */
export function containerParentIds(elements: Iterable<ElementsHeadRow>): UUID[] {
  const ids = new Set<UUID>();
  for (const element of elements) {
    if (element.element_type === 'container' && element.parent_id !== null) ids.add(element.parent_id);
  }
  return [...ids];
}

/**
 * Every value_stream stage's own parent stream id among `elements` — the
 * same batch `containerParentIds` collects for a module's platform, but
 * for a stage's stream ("Stream · Stage", `endpointDisplayName`'s own
 * value_stream case). A stage's parent stream is never itself a
 * relationship endpoint, so the from/to/via batch never includes it and
 * this is always a second, small, targeted lookup.
 */
export function valueStreamParentIds(elements: Iterable<ElementsHeadRow>): UUID[] {
  const ids = new Set<UUID>();
  for (const element of elements) {
    if (element.element_type === 'value_stream' && element.parent_id !== null) ids.add(element.parent_id);
  }
  return [...ids];
}

/**
 * `moduleDisplayName(element, parent)`, `parent` looked up from
 * `elementsById` by `element.parent_id` — the common shape every caller
 * with a plain "every element I might need, by id" map already has (once
 * `containerParentIds`'s own batch is merged into it), rather than
 * resolving the parent by hand at each call site.
 */
export function moduleDisplayNameFromMap(element: ElementsHeadRow, elementsById: ReadonlyMap<UUID, ElementsHeadRow>): string {
  const parent = element.parent_id !== null ? (elementsById.get(element.parent_id) ?? null) : null;
  return moduleDisplayName(element, parent);
}
