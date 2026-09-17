/**
 * The one shared "capability rollup" for a level-1 tile — decided
 * (Sprint U4-2, "capability rollup"): a level-1 tile's system count and its
 * "N/M supported" fraction are always a rollup over the capability's own
 * subtree (itself plus every level-2/level-3 descendant), deduped by
 * system — a system supporting two children of the same parent counts
 * once. Every surface that renders a level-1 tile calls this instead of
 * computing its own ad hoc count: the capability map (desktop and mobile,
 * `CapabilityMapView.tsx`), the director door (`DirectorHome.tsx`, via
 * `src/db/modelHome.ts`'s `buildCapabilityTiles`), and the capability-scoped
 * landscape (`useCapabilityLandscape.ts`).
 *
 * Two things this module deliberately does *not* recompute, because
 * they're already built and this decision doesn't touch them:
 * - **Exposure and lifecycle tone** stay worst-of-children, exactly as
 *   `metrics.ts`'s `aggregateTileColourFor` already computes them. This
 *   module supplies that function's own `descendantCapabilityIds` input
 *   (`subtreeCapabilityIds` below) and the edge scope `computeExposureTone`
 *   (`modelHome.ts`) needs to roll up the same way
 *   (`subtreeSupportsEdges` below) — callers pass those straight through,
 *   nothing here reimplements the worst-of logic itself.
 * - **Owner coverage** reuses `src/db/healthFindings.ts`'s
 *   `isCapabilityOwnedWithAncestry` as-is (already ancestor-aware, already
 *   exported for exactly this kind of reuse) — "covered if the capability
 *   or any ancestor has an owner." A level-1 capability has no ancestor of
 *   its own, so for every caller of this module `isOwned` reduces to the
 *   capability's own self-owned flag; the ancestor walk is kept anyway so
 *   this stays the same general predicate `findCapabilitiesWithoutOwner`
 *   already uses, not a narrower one reinvented for level-1 only.
 *
 * Level-2/leaf tiles never call this — per the same decision, they keep
 * showing their own direct count only (`metrics.ts`'s
 * `supportingSystemIds`/`tileColourFor`, unrolled).
 */
import type { FitForPurpose, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { isCapabilityOwnedWithAncestry } from '../../db/healthFindings';
import { capabilitySubtreeIds } from '../elements/capabilityDepth';
import { supportingSystemIds, worstFitForPurposeAcross } from './metrics';

export interface CapabilityRollup {
  /** The level-1 capability's own id plus every descendant's, itself included — feed straight into `aggregateTileColourFor`'s own `descendantCapabilityIds` parameter for the worst-of-children exposure/lifecycle/criticality/OT-share tone. */
  subtreeCapabilityIds: readonly UUID[];
  /** `supportsEdges` narrowed to only those targeting a subtree id — the scope `computeExposureTone`-style worst-of logic needs to see to roll up correctly (rather than just the level-1 capability's own direct edges). */
  subtreeSupportsEdges: readonly RelationshipsHeadRow[];
  /** Distinct systems with a live `supports` edge into the level-1 capability or any descendant — a system supporting two children of the same parent counts once. This is the rolled-up number every surface now shows in place of its old direct-only count. */
  supportingSystemIds: readonly UUID[];
  /**
   * `subtreeCapabilityIds.filter(id => it has >=1 direct supporter).length`
   * — the "N/M supported" fraction's numerator. This is the *only* place
   * that fraction is ever rendered as a number now: `metrics.ts`'s
   * `aggregateTileColourFor` used to independently compute and print the
   * identical fraction as its own `metric:supportingSystemCount` chip
   * label, which — once every L1 header started showing this rollup's own
   * "N capabilities · M systems · X/Y supported" line unconditionally —
   * put the same "X/Y" on screen twice at once. That chip's own label is
   * now a plain tone word instead (`aggregateTileColourFor`'s own doc
   * comment on Coverage); this field stays the one real source of the
   * number itself.
   */
  supportedCapabilityCount: number;
  /** `subtreeCapabilityIds.length` — the fraction's denominator. */
  totalCapabilityCount: number;
  /** `true` when the level-1 capability or any ancestor has an owner — see this module's own top comment for why that's always just the capability's own self-owned flag in practice. */
  isOwned: boolean;
  /** Worst `fitForPurpose` rating across every subtree `supports` edge — `poor` the worst (`metrics.ts`'s `worstFitForPurposeAcross`, "a poor rating anywhere below makes the parent read as poor"). `null` when nothing in the subtree is rated yet. */
  fitForPurpose: FitForPurpose | null;
}

/**
 * @param capability The level-1 capability to roll up. Calling this with an L2/L3 capability is legal (the subtree walk and ancestor-aware owner check both still work), but no current caller does — level-2/leaf tiles are deliberately unrolled.
 * @param allCapabilities Every capability in the model (or branch projection) — needed to walk the subtree.
 * @param capabilitiesById Same set, keyed by id — needed only by `isCapabilityOwnedWithAncestry`'s own parent/grandparent walk.
 * @param supportsEdges Every `supports` edge in scope (model-wide or branch-projected) — narrowed internally to the subtree.
 * @param selfOwnedIds `src/db/healthFindings.ts`'s `computeSelfOwnedCapabilityIds` result — a capability counts as self-owned via a direct `owns` edge or via an `owns` edge on a system that supports it.
 */
export function computeCapabilityRollup(
  capability: ElementsHeadRow,
  allCapabilities: readonly ElementsHeadRow[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
  supportsEdges: readonly RelationshipsHeadRow[],
  selfOwnedIds: ReadonlySet<UUID>,
): CapabilityRollup {
  const subtreeCapabilityIds = [...capabilitySubtreeIds(capability.element_id, allCapabilities)];
  const subtreeIdSet = new Set(subtreeCapabilityIds);
  const subtreeSupportsEdges = supportsEdges.filter((edge) => subtreeIdSet.has(edge.to_element_id));
  const supportingSystemIdList = [...new Set(subtreeSupportsEdges.map((edge) => edge.from_element_id))];
  const supportedCapabilityCount = subtreeCapabilityIds.filter((id) => supportingSystemIds(id, subtreeSupportsEdges).length > 0).length;

  return {
    subtreeCapabilityIds,
    subtreeSupportsEdges,
    supportingSystemIds: supportingSystemIdList,
    supportedCapabilityCount,
    totalCapabilityCount: subtreeCapabilityIds.length,
    isOwned: isCapabilityOwnedWithAncestry(capability, selfOwnedIds, capabilitiesById),
    fitForPurpose: worstFitForPurposeAcross(subtreeCapabilityIds, subtreeSupportsEdges),
  };
}
