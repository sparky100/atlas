/**
 * The pure data-shaping half of `CapabilityMapInspectorContent.tsx`'s
 * Selection/Connections sections — split into its own file for the same
 * two reasons `src/ui/landscape/landscapeInspectorSelection.ts` already
 * gives: independently unit-testable, and doesn't trip
 * `react-refresh/only-export-components`.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { CapabilityMapTree } from './layout';

export interface CapabilityMapSupportingSystem {
  systemId: UUID;
  systemName: string;
}

/**
 * A capability's own level (1/2/3) by where it sits in the already-built
 * `CapabilityMapTree` — cheaper and more direct than re-deriving it from
 * the raw `parent_id` chain (`capabilityDepth.ts`'s `capabilityLevel`)
 * since every call site that can trigger the Inspector (an L1 header, an
 * L2 card, an L3 tile) already has this exact tree in hand. `null` for an
 * id that isn't in the tree at all (an orphan, or stale after a reload
 * raced the click).
 */
export function capabilityMapLevelOf(capabilityId: UUID, tree: CapabilityMapTree): 1 | 2 | 3 | null {
  for (const column of tree.l1) {
    if (column.capability.element_id === capabilityId) return 1;
    for (const card of column.l2) {
      if (card.capability.element_id === capabilityId) return 2;
      if (card.l3.some((leaf) => leaf.element_id === capabilityId)) return 3;
    }
  }
  return null;
}

/** Every system with a live `supports` edge directly into `capabilityId` (not rolled up through descendants — the Inspector's Selection section is about this one tile, the same "direct count" `metrics.ts`'s own `supportingSystemIds` already gives every non-L1 tile). */
export function capabilityMapInspectorSupportingSystems(
  capabilityId: UUID,
  supportsEdges: readonly RelationshipsHeadRow[],
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>,
): CapabilityMapSupportingSystem[] {
  const result: CapabilityMapSupportingSystem[] = [];
  for (const edge of supportsEdges) {
    if (edge.to_element_id !== capabilityId) continue;
    const system = systemsById.get(edge.from_element_id);
    result.push({ systemId: edge.from_element_id, systemName: system?.name ?? edge.from_element_id });
  }
  return result;
}
