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
 *
 * Sprint U4-2b item 12 adds a third bucket, `supports`, the same shape as
 * `owners`: real information about the hub (its own `supports` edges to a
 * capability), surfaced as the header's "Supports: ..." line, never a
 * Context node and never a drawn edge — the first rule above still holds,
 * `supports` just isn't silently dropped on the floor any more the way it
 * was before this item.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';

export interface ContextNeighbour {
  element: ElementsHeadRow;
  /** The `uses`/`flows_to` edges connecting this neighbour to the hub — always at least one (that's how it got here); occasionally two, if the pair is connected both ways. */
  edges: RelationshipsHeadRow[];
}

/** One capability the hub *system* supports (`supports: system -> capability`) — Sprint U4-2b item 12's own header line, never a Context node or a drawn edge (this module's own first rule still holds: `supports` is the landscape's lane structure). */
export interface ContextSupport {
  capability: ElementsHeadRow;
  /** `SupportsAttributes.role === 'primary'` on this edge — item 12's "primary first" ordering (`supports` below). */
  primary: boolean;
}

/** One actor owning the hub, and in what role (Prompt 7k item 2 — `owns.role`) — `ContextGroup.owners` below, real Context nodes with no drawn edge (see module comment). A target can have up to three of these at once (one per role), never deduped by actor: the same actor could in principle hold two different roles via two separate `owns` edges. */
export interface ContextOwner {
  actor: ElementsHeadRow;
  role: string;
}

export interface ContextGroup {
  hub: ElementsHeadRow;
  /** Non-external neighbours, reached via a drawn `uses`/`flows_to` edge. */
  internal: ContextNeighbour[];
  /** External neighbours (`isExternal: true`), reached via a drawn edge — UI-principles' "outside a ring". */
  external: ContextNeighbour[];
  /** Actors that `own` the hub (ADR-001: `owns: actor → system`), each with its own role — real Context nodes with no drawn edge (see module comment). */
  owners: ContextOwner[];
  /** Sprint U4-2b item 12: the header's "Supports: <capabilities, primary first>" line — see `ContextSupport`'s own comment for why this is neither a node nor a drawn edge, same as `owners`. */
  supports: ContextSupport[];
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
  const ownerEntries: { actorId: UUID; role: string }[] = [];
  // Keyed by capability id, not a list: at most one supports edge is ever
  // expected between one system and one capability, so the last one seen
  // (there should only ever be one) simply wins.
  const supportsEdgeByCapabilityId = new Map<UUID, RelationshipsHeadRow>();

  for (const rel of relationships) {
    const otherId = rel.from_element_id === hub.element_id ? rel.to_element_id : rel.from_element_id;
    if (otherId === hub.element_id) continue; // a self-relationship shouldn't exist, but this function never assumes it can't.

    if (rel.relationship_type === 'owns' && rel.to_element_id === hub.element_id) {
      const role = attributesRecord(rel.attributes).role;
      // Named by a relationship but no role recorded: same "never render
      // for data that isn't there" stance as an unresolved element below —
      // real `owns` data always carries one (`OwnsAttributes.role` is
      // required), so this only ever skips malformed/pre-migration data.
      if (typeof role === 'string') ownerEntries.push({ actorId: rel.from_element_id, role });
      continue;
    }
    if (rel.relationship_type === 'supports' && rel.from_element_id === hub.element_id) {
      supportsEdgeByCapabilityId.set(rel.to_element_id, rel);
      continue;
    }
    if (rel.relationship_type !== 'uses' && rel.relationship_type !== 'flows_to') continue; // owns-the-other-way, or a supports edge in the other direction: not a Context node source.

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

  const owners: ContextOwner[] = ownerEntries
    .map(({ actorId, role }): ContextOwner | null => {
      const actor = elementsById.get(actorId);
      return actor ? { actor, role } : null; // named by a relationship but not resolved: same "never render for data that isn't there" stance as internal/external above.
    })
    .filter((o): o is ContextOwner => o !== null)
    .sort((a, b) => a.role.localeCompare(b.role) || byNameThenId(a.actor, b.actor));

  const supports: ContextSupport[] = [...supportsEdgeByCapabilityId.entries()]
    .map(([capabilityId, edge]): ContextSupport | null => {
      const capability = elementsById.get(capabilityId);
      return capability ? { capability, primary: attributesRecord(edge.attributes).role === 'primary' } : null; // named by a relationship but not resolved: same "never render for data that isn't there" stance as internal/external above.
    })
    .filter((s): s is ContextSupport => s !== null)
    .sort((a, b) => (a.primary === b.primary ? byNameThenId(a.capability, b.capability) : a.primary ? -1 : 1));

  return { hub, internal, external, owners, supports };
}
