/**
 * The pure data-shaping half of `ValueStreamInspectorContent.tsx` — same
 * split, and same two reasons, as `src/ui/capabilityMap/capabilityMapInspectorSelection.ts`:
 * independently unit-testable, and doesn't trip `react-refresh/only-export-components`.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import type { ValueStreamStageRollup } from './valueStreamRollup';

/** One enabling capability's own tile data, as this stage's Inspector panel shows it — the exact `CapabilityTileData` the rollup already resolved for it, no re-derivation. */
export interface ValueStreamInspectorCapability {
  tile: CapabilityTileData;
}

/** Every capability that enables `stage`, resolved from the already-built tile map — name-sorted for a stable panel order. A `enablingCapabilityId` with no tile (shouldn't happen — every id in that list came from `tilesByCapabilityId`'s own key set) is silently skipped rather than shown as a broken row. */
export function valueStreamInspectorEnablingCapabilities(stage: ValueStreamStageRollup, tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData>): ValueStreamInspectorCapability[] {
  return stage.enablingCapabilityIds
    .map((id) => tilesByCapabilityId.get(id))
    .filter((tile): tile is CapabilityTileData => tile !== undefined)
    .sort((a, b) => a.capability.name.localeCompare(b.capability.name))
    .map((tile) => ({ tile }));
}

/** The stream a given stage belongs to (`parent_id`) — the Inspector's own "Stream › Stage" heading. `null` if the stage's parent isn't in `valueStreamsById` (shouldn't happen for a live stage). */
export function valueStreamInspectorParentStream(stage: ElementsHeadRow, valueStreamsById: ReadonlyMap<UUID, ElementsHeadRow>): ElementsHeadRow | null {
  return stage.parent_id ? (valueStreamsById.get(stage.parent_id) ?? null) : null;
}
