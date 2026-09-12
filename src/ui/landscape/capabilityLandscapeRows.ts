/**
 * Sprint U4-2c item 2: "Capability-scoped landscape (/landscape?capability=X,
 * desktop and mobile): a flat list of the systems supporting X, sectioned
 * Primary / Also supports, child capabilities' systems included with the
 * child named ... No lanes, no cross-lane chips." This is a genuinely
 * different query from the exact-match filter the capability map tile's own
 * supporting-system count uses (`db/capabilityMap.ts`'s own
 * `listSupportsEdgesForCapabilities` doc comment): "systems supporting X"
 * here rolls up through X's own descendant capabilities too — a system
 * supporting a child of X is still a real answer to "what supports X", and
 * this view names which child rather than silently merging it in.
 *
 * No lanes means no `layout.ts` reference-marker concept either (that
 * mechanism exists purely to place a *second* chip for a system whose
 * primary lane lies elsewhere on the canvas) — every system in scope gets
 * exactly one row here, sectioned by its own supports edge's `role`
 * (`SupportsRole`) into "Primary"/"Also supports", the same two-way split
 * `landscapeGroups.ts`'s own `role` field already gives the mobile list,
 * just without a lane to hang it off.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';

export interface CapabilityLandscapeRow {
  system: ElementsHeadRow;
  /** This row's own supports edge's role — "Primary"/"Also supports" section, never both (C17: at most one live `role: 'primary'` supports edge per system, model-wide). */
  role: 'primary' | 'secondary';
  /** Set only when the edge naming this row's own `role` targets a descendant of the root capability, never the root itself — the child capability's own row, so "systems supporting X" can still say *how* without a second lookup. */
  viaCapability: ElementsHeadRow | null;
  owner: ElementsHeadRow | null;
  usesCount: number;
  usedByCount: number;
}

export interface CapabilityLandscapeRows {
  primary: CapabilityLandscapeRow[];
  secondary: CapabilityLandscapeRow[];
  /** `primary.length + secondary.length` — the title's own "(N)". */
  count: number;
}

function byNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

/**
 * `rootId`'s own subtree, `rootId` itself included — a capability's parent
 * is always another capability or null (V2), and nesting is capped at 3
 * levels (ADR-016), but this walk doesn't lean on that cap: it's a plain
 * breadth-first walk over `parent_id`, guarded against ever revisiting an
 * id, so it terminates cleanly regardless of depth.
 */
export function capabilitySubtreeIds(rootId: UUID, allCapabilities: readonly ElementsHeadRow[]): Set<UUID> {
  const childrenByParentId = new Map<UUID, UUID[]>();
  for (const capability of allCapabilities) {
    if (capability.parent_id === null) continue;
    const children = childrenByParentId.get(capability.parent_id) ?? [];
    children.push(capability.element_id);
    childrenByParentId.set(capability.parent_id, children);
  }
  const ids = new Set<UUID>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const next: UUID[] = [];
    for (const id of frontier) {
      for (const childId of childrenByParentId.get(id) ?? []) {
        if (!ids.has(childId)) {
          ids.add(childId);
          next.push(childId);
        }
      }
    }
    frontier = next;
  }
  return ids;
}

/**
 * @param rootCapabilityId The capability named by `?capability=` — only used to decide `viaCapability` (a direct edge to it names no child; an edge to any other capability in `subtreeSupportsEdges` always names one, since every one of them is `rootCapabilityId`'s own descendant by construction).
 * @param subtreeSupportsEdges `supports` edges targeting `rootCapabilityId` or any of its descendants (`capabilitySubtreeIds`'s own result) — never a wider or narrower set.
 * @param systemsById Every system/module those edges name, keyed by id (platform modules already relabelled "Platform · Module", `landscapeModules.ts`).
 * @param capabilitiesById Every capability in the subtree, keyed by id — used only to resolve `viaCapability`'s own name and to break a tie deterministically when a system supports more than one of them.
 * @param edges `uses`/`flows_to` edges among the resulting systems, for each row's own "uses N · used by N".
 * @param ownersByElementId Same shape `db/elementBrowse.ts`'s `ownersByElementIdFromOwnsEdges` returns.
 */
export function computeCapabilityLandscapeRows(
  rootCapabilityId: UUID,
  subtreeSupportsEdges: readonly RelationshipsHeadRow[],
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>,
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
  edges: readonly RelationshipsHeadRow[],
  ownersByElementId: ReadonlyMap<UUID, ElementsHeadRow>,
): CapabilityLandscapeRows {
  const usesCountByElementId = new Map<UUID, number>();
  const usedByCountByElementId = new Map<UUID, number>();
  for (const edge of edges) {
    usesCountByElementId.set(edge.from_element_id, (usesCountByElementId.get(edge.from_element_id) ?? 0) + 1);
    usedByCountByElementId.set(edge.to_element_id, (usedByCountByElementId.get(edge.to_element_id) ?? 0) + 1);
  }

  // One row per system: a system can support more than one capability in
  // the subtree at once (its own edge into the root included) — this picks
  // the single most useful edge to report per row, deterministically
  // (CLAUDE.md rule 6), rather than emitting one row per edge. A `primary`
  // edge always wins (it's this row's one real "home" among the edges in
  // scope, and the whole reason the Primary/Also-supports split exists); a
  // direct edge to the root wins over one to a child (naming a child only
  // adds information when there's no direct edge to name instead); any
  // remaining tie breaks on the target capability's own name then id.
  const edgesBySystemId = new Map<UUID, RelationshipsHeadRow[]>();
  for (const edge of subtreeSupportsEdges) {
    const list = edgesBySystemId.get(edge.from_element_id) ?? [];
    list.push(edge);
    edgesBySystemId.set(edge.from_element_id, list);
  }

  const rows: CapabilityLandscapeRow[] = [];
  for (const [systemId, ownEdges] of edgesBySystemId) {
    const system = systemsById.get(systemId);
    if (!system) continue;
    const [chosen] = [...ownEdges].sort((a, b) => {
      const aPrimary = attributesRecord(a.attributes).role === 'primary';
      const bPrimary = attributesRecord(b.attributes).role === 'primary';
      if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
      const aRoot = a.to_element_id === rootCapabilityId;
      const bRoot = b.to_element_id === rootCapabilityId;
      if (aRoot !== bRoot) return aRoot ? -1 : 1;
      const aCapability = capabilitiesById.get(a.to_element_id);
      const bCapability = capabilitiesById.get(b.to_element_id);
      return (aCapability?.name ?? '').localeCompare(bCapability?.name ?? '') || a.to_element_id.localeCompare(b.to_element_id);
    });
    if (!chosen) continue;
    const role = attributesRecord(chosen.attributes).role === 'primary' ? 'primary' : 'secondary';
    const viaCapability = chosen.to_element_id === rootCapabilityId ? null : (capabilitiesById.get(chosen.to_element_id) ?? null);
    rows.push({
      system,
      role,
      viaCapability,
      owner: ownersByElementId.get(systemId) ?? null,
      usesCount: usesCountByElementId.get(systemId) ?? 0,
      usedByCount: usedByCountByElementId.get(systemId) ?? 0,
    });
  }

  const primary = rows.filter((row) => row.role === 'primary').sort((a, b) => byNameThenId(a.system, b.system));
  const secondary = rows.filter((row) => row.role === 'secondary').sort((a, b) => byNameThenId(a.system, b.system));
  return { primary, secondary, count: rows.length };
}
