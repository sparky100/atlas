/**
 * The Context view's grouping (UI-principles.md §6.1: "one system, every
 * system/actor it has a relationship with... radial, scope at centre,
 * externals outside a ring"). Grouping, not pixel placement — same spirit
 * as src/ui/capabilityMap/layout.ts: a deterministic classification of
 * "what belongs where," with the DOM/CSS renderer doing the actual radial
 * arrangement (src/ui/context/ContextView.tsx's own comment explains why
 * this view renders as DOM rather than Canvas, the same reasoning the
 * capability map already used).
 *
 * Two rules this file exists to get right, both derived from ADR-001's
 * `relationship_type_rules` and UI-principles §9's "`owns` never drawn on
 * canvas (shown on the element page)" rather than invented here:
 *
 *  - Edges actually drawn are `uses`/`flows_to` only — the same restriction
 *    every canvas view in this product applies (`supports` is the
 *    landscape's lane structure, never an edge; `owns` is page-only).
 *  - An actor can *only* ever reach a system via `owns` (`relationship_type_
 *    rules` has no `uses`/`flows_to` row with an actor endpoint at all) —
 *    yet the Nodes column explicitly names "system/actor" as valid Context
 *    content. The only reading that keeps both rules true at once: an
 *    owning actor is a real node here (grouped separately, as `owners`),
 *    just with no line drawn to it — which is exactly what "shown on the
 *    element page" already implies for the fact of ownership itself.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';

export interface ContextNeighbour {
  element: ElementsHeadRow;
  /** The `uses`/`flows_to` edges connecting this neighbour to the hub — always at least one (that's how it got here); occasionally two, if the pair is connected both ways. */
  edges: RelationshipsHeadRow[];
}

export interface ContextGroup {
  hub: ElementsHeadRow;
  /** Non-external neighbours, reached via a drawn `uses`/`flows_to` edge. */
  internal: ContextNeighbour[];
  /** External neighbours (`isExternal: true`), reached via a drawn edge — UI-principles' "outside a ring". */
  external: ContextNeighbour[];
  /** Actors that `own` the hub (ADR-001: `owns: actor → system`) — real Context nodes with no drawn edge (see module comment). */
  owners: ElementsHeadRow[];
}

function isExternal(element: ElementsHeadRow): boolean {
  return attributesRecord(element.attributes).isExternal === true;
}

function byNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

/**
 * @param hub The system this Context view is scoped to.
 * @param relationships Every relationship touching `hub` — `src/db/elements.ts`'s `listRelationshipsForElement`, unfiltered; this function does the type filtering itself so the query stays the same one every other "everything touching this element" reader already uses.
 * @param elementsById Every other endpoint named by `relationships`, by id — batch-loaded via `getElementsByIds`.
 */
export function computeContextGroup(hub: ElementsHeadRow, relationships: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): ContextGroup {
  const neighbourEdges = new Map<UUID, RelationshipsHeadRow[]>();
  const ownerIds = new Set<UUID>();

  for (const rel of relationships) {
    const otherId = rel.from_element_id === hub.element_id ? rel.to_element_id : rel.from_element_id;
    if (otherId === hub.element_id) continue; // a self-relationship shouldn't exist, but this function never assumes it can't.

    if (rel.relationship_type === 'owns' && rel.to_element_id === hub.element_id) {
      ownerIds.add(rel.from_element_id);
      continue;
    }
    if (rel.relationship_type !== 'uses' && rel.relationship_type !== 'flows_to') continue; // supports/owns-the-other-way: not a Context node source.

    const list = neighbourEdges.get(otherId) ?? [];
    list.push(rel);
    neighbourEdges.set(otherId, list);
  }

  const internal: ContextNeighbour[] = [];
  const external: ContextNeighbour[] = [];
  for (const [elementId, edges] of neighbourEdges) {
    const element = elementsById.get(elementId);
    if (!element) continue; // named by a relationship but not resolved (e.g. retracted since) — never render a node for data that isn't there.
    (isExternal(element) ? external : internal).push({ element, edges });
  }
  internal.sort((a, b) => byNameThenId(a.element, b.element));
  external.sort((a, b) => byNameThenId(a.element, b.element));

  const owners = [...ownerIds]
    .map((id) => elementsById.get(id))
    .filter((e): e is ElementsHeadRow => e !== undefined)
    .sort(byNameThenId);

  return { hub, internal, external, owners };
}
