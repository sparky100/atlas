/**
 * The Portfolio view's own "costly overlap" signal needs one piece of
 * cross-row knowledge no other metric here needs: whether a capability has
 * *two or more* distinct top-level systems each spending in the high-cost
 * band to support it. Computed once over the whole model (every `supports`
 * edge from every system or module container, regardless of whether the
 * containers toggle is currently showing module rows at all) so a row's
 * own signal never changes when that toggle flips — the toggle only
 * decides which rows are *displayed*, never what this computation sees.
 *
 * "Top-level system, not element": a platform and its own modules are one
 * spender, not several — `topLevelSystemIdOf` collapses a module container
 * onto its parent platform (`parent_id`, guaranteed non-null and always a
 * `system` for a container — V2's own structural requirement,
 * `src/engine/convertSystemToModule.ts`'s doc comment). A top-level
 * system's own spend on one capability is the *highest* band among itself
 * and its modules' own edges into that capability — never summed, per
 * `annualRunCost.ts`'s own "bands are ordinal, never arithmetic" rule.
 */
import type { AnnualRunCost, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { ANNUAL_RUN_COST_ORDER, annualRunCostRank } from '../elementRead/annualRunCost';
import { attributesRecord } from '../elementRead/attributesRecord';

/** The global "high cost" threshold (the task's own constant, not a setting) — a band at or above this counts as high cost everywhere in the Portfolio view. */
export const HIGH_COST_MIN_BAND: AnnualRunCost = '250k_1m';

/** `true` only for a real, recorded band at or above `HIGH_COST_MIN_BAND` — `null` (not entered) is never high cost. */
export function isHighCostBand(band: AnnualRunCost | null): boolean {
  return band !== null && annualRunCostRank(band) >= annualRunCostRank(HIGH_COST_MIN_BAND);
}

/** `true` only for a real, recorded band of `none_included` or `under_50k` — "cost under 50k or none/included." `null` (not entered) is never cheap. */
export function isCheapCostBand(band: AnnualRunCost | null): boolean {
  return band === 'none_included' || band === 'under_50k';
}

/** An element's own `annualRunCost`, or `null` if unset/unrecognised — the same "exported for reuse, not private to one caller" reasoning gives `portfolioSignals.ts` this same read directly. */
export function annualRunCostOf(element: ElementsHeadRow): AnnualRunCost | null {
  const value = attributesRecord(element.attributes).annualRunCost;
  return typeof value === 'string' && (ANNUAL_RUN_COST_ORDER as readonly string[]).includes(value) ? (value as AnnualRunCost) : null;
}

/** A container's own top-level system — itself, if this element already is a system; its (always-present) parent otherwise. Throws on a container with no parent, which V2's own structural rule never allows — an impossible case, not a silently-tolerated one. */
export function topLevelSystemIdOf(element: ElementsHeadRow): UUID {
  if (element.element_type !== 'container') return element.element_id;
  if (element.parent_id === null) throw new Error(`Portfolio: module container ${element.element_id} has no parent — a container's parent is required and always a system.`);
  return element.parent_id;
}

/**
 * Every top-level system id supporting `capabilityId` (directly or via one
 * of its own modules), each with the highest `annualRunCost` band recorded
 * across that top-level system's own contributing edges into this
 * capability — `null` if none of them has one entered. Exported (not just
 * `highCostOverlapByCapability`'s own private helper) because the
 * Portfolio view's row-expand ("why this cost") needs the identical
 * per-capability roll-up for its own "other supporters" list — same
 * definition, not a second one computed from scratch in `usePortfolio.ts`.
 */
export function topLevelSupporterBands(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): Map<UUID, AnnualRunCost | null> {
  const bands = new Map<UUID, AnnualRunCost | null>();
  for (const edge of supportsEdges) {
    if (edge.relationship_type !== 'supports' || edge.to_element_id !== capabilityId) continue;
    const supporter = elementsById.get(edge.from_element_id);
    if (!supporter) continue;
    const topLevelId = topLevelSystemIdOf(supporter);
    const band = annualRunCostOf(supporter);
    const existing = bands.get(topLevelId);
    if (existing === undefined) {
      bands.set(topLevelId, band);
    } else if (band !== null && (existing === null || annualRunCostRank(band) > annualRunCostRank(existing))) {
      bands.set(topLevelId, band);
    }
  }
  return bands;
}

/**
 * For every capability with two or more distinct top-level systems each at
 * or above `HIGH_COST_MIN_BAND`, the map entry `capabilityId -> Set` of
 * those top-level systems' own ids — a capability with zero or one
 * high-cost supporter has no entry at all (no overlap to report).
 */
export function highCostOverlapByCapability(supportsEdges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): Map<UUID, ReadonlySet<UUID>> {
  const capabilityIds = new Set<UUID>();
  for (const edge of supportsEdges) {
    if (edge.relationship_type === 'supports') capabilityIds.add(edge.to_element_id);
  }
  const overlaps = new Map<UUID, ReadonlySet<UUID>>();
  for (const capabilityId of capabilityIds) {
    const bands = topLevelSupporterBands(capabilityId, supportsEdges, elementsById);
    const highCostSupporters = new Set<UUID>();
    for (const [topLevelId, band] of bands) {
      if (isHighCostBand(band)) highCostSupporters.add(topLevelId);
    }
    if (highCostSupporters.size >= 2) overlaps.set(capabilityId, highCostSupporters);
  }
  return overlaps;
}

/**
 * The capability ids that make a given top-level system's own "costly
 * overlap" signal fire: every capability where `overlapsByCapability`
 * (`highCostOverlapByCapability`'s own result) lists this top-level
 * system among its high-cost supporters. Shared identically by a
 * platform's own row and every one of its module rows — the signal is a
 * property of the top-level system, per the module comment above, not of
 * whichever individual element happens to be rendered as a row.
 */
export function overlapCapabilityIdsFor(topLevelSystemId: UUID, overlapsByCapability: ReadonlyMap<UUID, ReadonlySet<UUID>>): UUID[] {
  const ids: UUID[] = [];
  for (const [capabilityId, supporters] of overlapsByCapability) {
    if (supporters.has(topLevelSystemId)) ids.push(capabilityId);
  }
  return ids;
}
