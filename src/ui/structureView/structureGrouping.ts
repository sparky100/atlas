/**
 * The Container view's grouping (UI-principles.md §6.1): "one system, its
 * containers, plus external systems/containers they `uses`/`flows_to`...
 * layered inside the [parent] frame; externals outside." Grouping, same
 * spirit as src/ui/context/contextGrouping.ts — a deterministic
 * classification, with src/ui/structureView/StructureView.tsx's DOM/CSS
 * renderer doing the actual placement. This used to be shared with a
 * Component view one level deeper, until S1 item 18 removed the component
 * level from the taxonomy entirely.
 *
 * "External" here means, precisely: the other endpoint of a `uses`/
 * `flows_to` relationship touching one of `parent`'s own children, where
 * that endpoint is not itself one of those children — a container in a
 * *different* system, or a whole system reached via `container → system
 * uses` (ADR-001's `relationship_type_rules`). A relationship between two
 * of the parent's own children is drawn inline, not listed as external.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';

export interface StructureExternal {
  element: ElementsHeadRow;
  edges: RelationshipsHeadRow[];
}

export interface StructureGroup {
  parent: ElementsHeadRow;
  /** `parent`'s own children (containers) — sorted deterministically. */
  children: ElementsHeadRow[];
  /** Relationships between two of `children` themselves — drawn inside the frame. */
  internalEdges: RelationshipsHeadRow[];
  /** Elements outside the frame, reached via a relationship from/to one of `children` — sorted deterministically. */
  externals: StructureExternal[];
}

function byNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

/**
 * @param parent The System (Container view) or Container (Component view) this view is scoped to.
 * @param children `parent`'s own children — `listChildrenOf` (src/db/elements.ts).
 * @param relationships Every relationship touching any of `children` — `listRelationshipsTouchingAny` (src/db/structureView.ts), already filtered to the view's allowed types (`uses`+`flows_to` for Container, `uses` only for Component).
 * @param elementsById Every external endpoint named by `relationships`, by id.
 */
export function computeStructureGroup(
  parent: ElementsHeadRow,
  children: readonly ElementsHeadRow[],
  relationships: readonly RelationshipsHeadRow[],
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>,
): StructureGroup {
  const childIds = new Set(children.map((c) => c.element_id));
  const sortedChildren = [...children].sort(byNameThenId);

  const internalEdges: RelationshipsHeadRow[] = [];
  const externalEdges = new Map<UUID, RelationshipsHeadRow[]>();

  for (const rel of relationships) {
    const fromIsChild = childIds.has(rel.from_element_id);
    const toIsChild = childIds.has(rel.to_element_id);
    if (fromIsChild && toIsChild) {
      internalEdges.push(rel);
      continue;
    }
    const externalId = fromIsChild ? rel.to_element_id : rel.from_element_id;
    const list = externalEdges.get(externalId) ?? [];
    list.push(rel);
    externalEdges.set(externalId, list);
  }

  const externals: StructureExternal[] = [];
  for (const [elementId, edges] of externalEdges) {
    const element = elementsById.get(elementId);
    if (!element) continue; // named by a relationship but not resolved — never render a node for data that isn't there.
    externals.push({ element, edges });
  }
  externals.sort((a, b) => byNameThenId(a.element, b.element));

  return { parent, children: sortedChildren, internalEdges, externals };
}
