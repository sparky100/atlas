/**
 * Pure order-resolution logic, split out from useCapabilityReorder.ts so it
 * can be unit-tested with no Supabase client in the import graph at all —
 * the same reasoning src/ui/orgs/roleGates.ts's own module comment gives:
 * useCapabilityReorder.ts's own `swap` pulls in src/ui/supabaseClient.ts,
 * which throws at import time without VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
 * set, exactly the environment a plain `vitest run` unit test doesn't have.
 * Re-exported from useCapabilityReorder.ts, so every existing import site is
 * unaffected — this is a location split, not a public API change.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';

function orderOf(row: ElementsHeadRow): number | null {
  const order = attributesRecord(row.attributes).order;
  return typeof order === 'number' ? order : null;
}

/**
 * S1 item 13's "order assigned on the fly when missing": resolves the pair's
 * current (or freshly-assigned) `order` values without refusing the swap.
 * When both already have one, they're returned unchanged. Otherwise,
 * whichever is missing gets one past the highest order among `siblings`
 * (that capability's own full sibling group) — never colliding with an
 * already-ordered sibling. If both are missing, the one that already
 * displays first among `siblings` (`compareCapabilities`'s own order, the
 * order the caller built `siblings` in) gets the lower of the two fresh
 * values, so the swap that follows still has a coherent before/after pair
 * to move rather than two arbitrary numbers.
 */
export function resolveOrders(siblings: readonly ElementsHeadRow[], capability: ElementsHeadRow, neighbor: ElementsHeadRow): { capabilityOrder: number; neighborOrder: number } {
  const existingCapability = orderOf(capability);
  const existingNeighbor = orderOf(neighbor);
  if (existingCapability !== null && existingNeighbor !== null) {
    return { capabilityOrder: existingCapability, neighborOrder: existingNeighbor };
  }

  let max = 0;
  for (const sibling of siblings) {
    const order = orderOf(sibling);
    if (order !== null && order > max) max = order;
  }

  if (existingCapability !== null) {
    return { capabilityOrder: existingCapability, neighborOrder: max + 1 };
  }
  if (existingNeighbor !== null) {
    return { capabilityOrder: max + 1, neighborOrder: existingNeighbor };
  }

  const capabilityIndex = siblings.findIndex((s) => s.element_id === capability.element_id);
  const neighborIndex = siblings.findIndex((s) => s.element_id === neighbor.element_id);
  return capabilityIndex <= neighborIndex ? { capabilityOrder: max + 1, neighborOrder: max + 2 } : { capabilityOrder: max + 2, neighborOrder: max + 1 };
}
