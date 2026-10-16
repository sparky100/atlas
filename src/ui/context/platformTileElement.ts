import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';

/**
 * The element behind a tile on the integration platform diagram. The
 * platform itself is never an endpoint of its own flows, so it is not in
 * `elementsById` (which holds only the flows' endpoints and their parents):
 * it is the `hub` prop, and a lookup in the map alone returned nothing for
 * it — the centre tile was never drawn, and every line ran into empty space.
 */
export function platformTileElement(elementId: UUID, isHub: boolean, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, hub: ElementsHeadRow): ElementsHeadRow | undefined {
  return elementsById.get(elementId) ?? (isHub ? hub : undefined);
}
