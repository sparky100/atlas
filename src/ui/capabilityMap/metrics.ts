/**
 * The capability map's colour-by modes. Nothing here is specified in
 * UI-principles.md/SPEC beyond the metric names the brief gives —
 * deliberately fact-derived counts/states, never an opinion score:
 * ADR-000 preface #6 and UI-principles §9 rule out a maturity heat-map
 * precisely because "a maturity score would be an opinion without a
 * source" (§9), and every tone below traces to a real, visible fact (a
 * real `supports` edge, a real `lifecycleStatus`/`plannedEnd` value on a
 * real system) — never a blended or weighted score.
 *
 * Four metrics: the original three matching the director door's own
 * health-chip vocabulary (§3.1), plus a fourth added by Prompt 7k item 1
 * (criticality) once systems started carrying a real, sourced severity
 * attribute of their own:
 *
 * - **Coverage** (`supportingSystemCount`): §3.1's own gap — a capability
 *   with no `supports` edge at all reads `warn`; any real count reads
 *   plain `neutral` regardless of magnitude, since a *larger* count is not
 *   "worse" (or "better") in any sense this product can source. Never
 *   colour-only (§6.3, §8.4, §8.7) — but the literal count sits in an
 *   adjacent, mode-independent count/fraction that's always on screen
 *   regardless of colour-by (`tileColourFor`'s own "N supporting systems"
 *   label sits beside `LandscapeZoomLink`'s "N systems →";
 *   `aggregateTileColourFor`'s own L1 chip sits beside the capability
 *   rollup's own always-shown "N/M supported" line, `capabilityRollup.ts`'s
 *   module comment) — so this metric's own label states the tone in words
 *   without repeating a number that's already right there (found as a
 *   literal on-screen duplicate at the L1 aggregate level: "3/6
 *   capabilities supported" showing twice in the same group header).
 * - **Oldest lifecycle stage** (`oldestLifecycleStage`): the most-advanced
 *   `lifecycleStatus` among supporting systems, using the exact tone
 *   mapping lifecycle chips already use everywhere else.
 * - **Exposure** (`lifecycleExposure`): §3.1's "lifecycle exposure" gap —
 *   a supporting system whose `plannedEnd` falls within
 *   `STALE_AFTER_MONTHS` (reusing the one global threshold, not a second
 *   one invented for this) and has no planned replacement. "No planned
 *   replacement" (ADR-001 amendment) reads a real fact: a supporting
 *   system with a live `replaces` edge into it (`replacedIds`, from
 *   `replacedElementIds` — the retiring side) never counts as exposed,
 *   however near or past its own `plannedEnd`. Existence-only: the
 *   replacement's own lifecycle is deliberately not considered.
 *   A caller that passes no `replacedIds` gets the plain `plannedEnd` read.
 * - **Criticality** (`criticality`): the most-severe `criticality` value
 *   (`low` < `medium` < `high` < `critical`) among a capability's
 *   supporting systems — worst-of, the same shape as oldest-lifecycle-
 *   stage, using `criticalityTone.ts`'s tone/order tables. `hostingModel`
 *   deliberately gets no capability-map equivalent: it's a categorical,
 *   unordered set (on-prem/private-cloud/public-cloud/SaaS/hybrid) with no
 *   "worst" value to aggregate to, so it's landscape-only
 *   (`src/ui/landscape/landscapeColour.ts`).
 * - **OT share** (`otShareOf`), Prompt 7k item 3: fraction of a
 *   capability's supporting systems whose domain resolves to `'ot'`
 *   (`systemDomain.ts`'s `domainOf`) — a fraction, not worst-of, the same
 *   "how many, not just whether any" reasoning `metric:supportingSystemCount`
 *   already uses; silent (no tone/label) at zero, unlike coverage, since
 *   "0 OT systems" is the ordinary case for most capabilities in a
 *   regulated estate and would otherwise be visual noise on every tile.
 * - **Fit** (`fitForPurpose`, `worstFitForPurpose`): worst-of the
 *   `fitForPurpose` ratings on a capability's own `supports` edges — a
 *   leaf-level fact recorded on the relationship, not a computed score
 *   (ADR-000 preface #6's maturity-scoring objection never applies: this
 *   is a sourced, per-edge assertion, worst-of'd exactly like criticality).
 *   Silent when no edge is rated.
 * - **Disposition** (`worstDispositionOf`), F11: worst-of the TIME
 *   dispositions (`invest` < `tolerate` < `migrate` < `eliminate`) among a
 *   capability's supporting systems and modules — each element's own
 *   recorded value, never a module inheriting its platform's (ADR-001's
 *   amendment; `effectiveModuleAttributes` deliberately leaves it out).
 *   Silent when none is assessed: "not assessed" never reads as Tolerate.
 *
 * `isExternal` was considered and dropped: a capability isn't external,
 * only (some of) its supporting systems are, and "any support system is
 * external" versus "most are" are different, both defensible readings
 * that would need their own design pass — not a natural third option
 * alongside two metrics that need no such judgment call.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { Criticality, Disposition, FitForPurpose, LifecycleStatus, UUID } from '../../contracts/delta';
import type { HomeMode } from '../../contracts/userPreferences';
import type { ChipTone } from '../components/Chip/Chip';
import { attributesRecord } from '../elements/attributesRecord';
import { CRITICALITY_ORDER, CRITICALITY_TONE } from '../elements/criticalityTone';
import { FIT_FOR_PURPOSE_ORDER, FIT_FOR_PURPOSE_TONE } from '../elements/fitForPurposeTone';
import { LIFECYCLE_ORDER, LIFECYCLE_TONE } from '../elements/lifecycleTone';
import { dispositionLabel, dispositionOf, dispositionTone, worstDisposition } from '../elements/disposition';
import { domainOf } from '../elements/systemDomain';
import { fitForPurposeOf, hasLifecycleExposureData, replacedElementIds, systemsExposedByLifecycle, worstFitForPurposeOfSupporter } from '../../engine/elementRead/fitAndExposure';

export { fitForPurposeOf, hasLifecycleExposureData, replacedElementIds, systemsExposedByLifecycle, worstFitForPurposeOfSupporter };

// The mode identifiers themselves are canonical in src/contracts/userPreferences.ts
// (Sprint U4-1 C4: they're now persisted, `user_preferences.capability_map_colour_by`)
// — re-exported under this file's own established name so its two existing
// callers (CapabilityMapView.tsx, this file) don't need to change.
export type { CapabilityMapColourByMode as ColourByMode } from '../../contracts/userPreferences';
import type { CapabilityMapColourByMode as ColourByMode } from '../../contracts/userPreferences';

export const COLOUR_BY_OPTIONS: { value: ColourByMode; label: string }[] = [
  { value: 'metric:supportingSystemCount', label: 'Coverage (supporting-system count)' },
  { value: 'metric:oldestLifecycleStage', label: 'Oldest lifecycle stage' },
  { value: 'metric:lifecycleExposure', label: 'Retirement risk' },
  { value: 'metric:criticality', label: 'Criticality' },
  { value: 'metric:otShare', label: 'OT share' },
  { value: 'metric:fitForPurpose', label: 'Fit' },
  { value: 'metric:disposition', label: 'Planned action' },
];

export interface TileColour {
  tone: ChipTone | undefined;
  label: string | undefined;
}

/** Every system id with a live `supports` edge into `capabilityId`. */
export function supportingSystemIds(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): UUID[] {
  return supportsEdges.filter((edge) => edge.to_element_id === capabilityId).map((edge) => edge.from_element_id);
}

function lifecycleStatusOf(system: ElementsHeadRow): LifecycleStatus | null {
  const value = attributesRecord(system.attributes).lifecycleStatus;
  return typeof value === 'string' && value in LIFECYCLE_ORDER ? (value as LifecycleStatus) : null;
}

/** The most-advanced stage (`planned` < `active` < `retiring` < `retired`) among a capability's supporting systems, or `null` if none have one recorded. */
export function oldestLifecycleStage(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>): LifecycleStatus | null {
  let oldest: LifecycleStatus | null = null;
  for (const systemId of supportingSystemIds(capabilityId, supportsEdges)) {
    const status = systemsById.get(systemId);
    if (!status) continue;
    const lifecycle = lifecycleStatusOf(status);
    if (lifecycle && (oldest === null || LIFECYCLE_ORDER[lifecycle] > LIFECYCLE_ORDER[oldest])) oldest = lifecycle;
  }
  return oldest;
}

function criticalityOf(system: ElementsHeadRow): Criticality | null {
  const value = attributesRecord(system.attributes).criticality;
  return typeof value === 'string' && value in CRITICALITY_ORDER ? (value as Criticality) : null;
}

/** The most-severe `criticality` (`low` < `medium` < `high` < `critical`) among a capability's supporting systems, or `null` if none have one recorded — the same worst-of shape as `oldestLifecycleStage`, per Prompt 7k item 1. */
export function worstCriticality(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>): Criticality | null {
  let worst: Criticality | null = null;
  for (const systemId of supportingSystemIds(capabilityId, supportsEdges)) {
    const system = systemsById.get(systemId);
    if (!system) continue;
    const criticality = criticalityOf(system);
    if (criticality && (worst === null || CRITICALITY_ORDER[criticality] > CRITICALITY_ORDER[worst])) worst = criticality;
  }
  return worst;
}

/**
 * The worst `fitForPurpose` rating recorded on a capability's own direct
 * `supports` edges, or `null` if none is rated — `poor` the worst, the same
 * "worst-of = max" shape `worstCriticality` already gives. Reads the
 * *edge's* attributes, not the supporting system's (`FitForPurpose` lives
 * on the relationship, a leaf-level fact), which is why this takes
 * `supportsEdges` and not `systemsById`.
 */
export function worstFitForPurpose(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): FitForPurpose | null {
  let worst: FitForPurpose | null = null;
  for (const edge of supportsEdges) {
    if (edge.to_element_id !== capabilityId) continue;
    const fit = fitForPurposeOf(edge);
    if (fit !== null && (worst === null || FIT_FOR_PURPOSE_ORDER[fit] > FIT_FOR_PURPOSE_ORDER[worst])) worst = fit;
  }
  return worst;
}


/**
 * This capability's own direct `supports` edges rated `poor` or `adequate`
 * — a weak fit, the threshold Overview's weak-capability tiles use since
 * 2026-10-03 (ADR-023's "director-door fit visibility" amendment, second
 * revision) — the edge-level detail `worstFitForPurpose`'s single
 * worst-value summary doesn't carry. Needed by Overview's own fit pill
 * (`src/db/modelHome.ts`'s `buildCapabilityTiles`) to check each weak
 * edge's own supporter against a planned replacement
 * (`groupPlannedReplacementsByCapability`). Deliberately reads every edge
 * regardless of `role` (ADR-023's "secondary-only widening accepted").
 */
export function weakFitSupportsEdges(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): RelationshipsHeadRow[] {
  return supportsEdges.filter((edge) => {
    if (edge.to_element_id !== capabilityId) return false;
    const fit = fitForPurposeOf(edge);
    return fit === 'poor' || fit === 'adequate';
  });
}

/** A capability's own direct `supports` edges, regardless of role. */
function directSupportsEdges(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): RelationshipsHeadRow[] {
  return supportsEdges.filter((edge) => edge.relationship_type === 'supports' && edge.to_element_id === capabilityId);
}

function supportsRoleOf(edge: RelationshipsHeadRow): string | undefined {
  const value = attributesRecord(edge.attributes).role;
  return typeof value === 'string' ? value : undefined;
}

export interface FitAssessmentEdges {
  edges: RelationshipsHeadRow[];
  /**
   * true when this capability has no live primary `supports` edge and
   * `edges` are its secondary edges instead. Callers use this to word
   * "supporter" rather than "primary supporter" copy accurately —
   * never assume primary once this is true.
   */
  usedSecondaryFallback: boolean;
}

/**
 * The `supports` edges that count toward a capability's own
 * fit-for-purpose *assessment* (as opposed to the Director roll-up above,
 * which deliberately reads every edge): its primary edges when at least
 * one exists, or every secondary edge only when it has none.
 *
 * `SupportsRole`'s own cardinality rule ("at most one live primary edge
 * per FROM system") is per-*system*, not per-capability — nothing stops
 * every one of a capability's supporting systems from naming `primary`
 * toward some *other* capability, leaving this one with real supporters
 * but zero primary edges into it — so this falls back to secondary edges
 * rather than dropping the primary-first read entirely (a capability with
 * even one good-fit primary edge stays judged on its primary edges alone,
 * never on a separately poor-fit secondary one). Its remaining caller is
 * `fitNotRatedEdges.ts`; the Architect door's poor-fit finding that it was
 * written for was retired on 2026-10-03 (ADR-023, fit threshold amendment).
 */
export function fitAssessmentSupportsEdges(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): FitAssessmentEdges {
  const direct = directSupportsEdges(capabilityId, supportsEdges);
  const primary = direct.filter((edge) => supportsRoleOf(edge) === 'primary');
  if (primary.length > 0) return { edges: primary, usedSecondaryFallback: false };
  return { edges: direct.filter((edge) => supportsRoleOf(edge) === 'secondary'), usedSecondaryFallback: true };
}

/** `worstFitForPurpose` maximised over a set of descendant capability ids — a poor rating anywhere below makes the group read as poor. */
export function worstFitForPurposeAcross(descendantCapabilityIds: readonly UUID[], supportsEdges: readonly RelationshipsHeadRow[]): FitForPurpose | null {
  let worst: FitForPurpose | null = null;
  for (const id of descendantCapabilityIds) {
    const fit = worstFitForPurpose(id, supportsEdges);
    if (fit !== null && (worst === null || FIT_FOR_PURPOSE_ORDER[fit] > FIT_FOR_PURPOSE_ORDER[worst])) worst = fit;
  }
  return worst;
}

/** The worst own disposition among a capability's supporting systems and modules, or `null` if none is assessed. */
export function worstDispositionOf(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>): Disposition | null {
  return worstDisposition(
    supportingSystemIds(capabilityId, supportsEdges).map((id) => {
      const system = systemsById.get(id);
      return system ? dispositionOf(system) : null;
    }),
  );
}

function dispositionColour(value: Disposition | null): TileColour {
  return value === null ? { tone: undefined, label: undefined } : { tone: dispositionTone(value), label: dispositionLabel(value) };
}

/** The count of a capability's supporting systems whose domain resolves to `'ot'`, out of the total — Prompt 7k item 3's "OT share". */
export function otShareOf(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>): { ot: number; total: number } {
  const ids = supportingSystemIds(capabilityId, supportsEdges);
  let ot = 0;
  for (const id of ids) {
    const system = systemsById.get(id);
    if (system && domainOf(system) === 'ot') ot += 1;
  }
  return { ot, total: ids.length };
}

export function lifecycleExposure(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date(), replacedIds?: ReadonlySet<UUID>): boolean {
  const systems: ElementsHeadRow[] = [];
  for (const systemId of supportingSystemIds(capabilityId, supportsEdges)) {
    const system = systemsById.get(systemId);
    if (system) systems.push(system);
  }
  return systemsExposedByLifecycle(systems, now, replacedIds);
}

/** The tone+label a tile should show for the selected colour-by mode — `mode: 'none'` always returns no tone and no label. */
export function tileColourFor(mode: ColourByMode, capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>, replacedIds?: ReadonlySet<UUID>): TileColour {
  switch (mode) {
    case 'none':
      return { tone: undefined, label: undefined };
    case 'metric:supportingSystemCount': {
      const count = supportingSystemIds(capabilityId, supportsEdges).length;
      // The literal count is never this label's own job — it's already
      // shown unconditionally right beside this chip, via `LandscapeZoomLink`'s
      // "N systems →" (both L2 cards and L3 tiles render one next to the
      // other, `L2CardView`/its own L3 map below) — this module's own top
      // comment on Coverage explains why repeating it here used to double
      // it up on screen.
      return { tone: count === 0 ? 'warn' : 'neutral', label: count === 0 ? 'no supporting systems' : 'supporting systems' };
    }
    case 'metric:oldestLifecycleStage': {
      const stage = oldestLifecycleStage(capabilityId, supportsEdges, systemsById);
      return stage === null ? { tone: undefined, label: undefined } : { tone: LIFECYCLE_TONE[stage], label: stage };
    }
    case 'metric:lifecycleExposure': {
      const exposed = lifecycleExposure(capabilityId, supportsEdges, systemsById, new Date(), replacedIds);
      return exposed ? { tone: 'danger', label: 'end of life' } : { tone: undefined, label: undefined };
    }
    case 'metric:criticality': {
      const worst = worstCriticality(capabilityId, supportsEdges, systemsById);
      return worst === null ? { tone: undefined, label: undefined } : { tone: CRITICALITY_TONE[worst], label: worst };
    }
    case 'metric:otShare': {
      const { ot, total } = otShareOf(capabilityId, supportsEdges, systemsById);
      return ot === 0 ? { tone: undefined, label: undefined } : { tone: 'neutral', label: `${String(ot)}/${String(total)} systems OT` };
    }
    case 'metric:fitForPurpose': {
      const worst = worstFitForPurpose(capabilityId, supportsEdges);
      return worst === null ? { tone: undefined, label: undefined } : { tone: FIT_FOR_PURPOSE_TONE[worst], label: worst };
    }
    case 'metric:disposition':
      return dispositionColour(worstDispositionOf(capabilityId, supportsEdges, systemsById));
  }
}

/**
 * The tone+label an L1 group's own header shows (a Chip alongside the
 * name, per the human's own review note on Sprint U4-1 C3 — "a strip/
 * chip... not a fill", unlike `tileColourFor`'s per-tile background
 * fill), aggregated across every L2 *and* L3 descendant capability, not
 * just the L1's own direct children — a capability whose only exposed
 * descendant sits at L3 still needs its L1 ancestor to read as exposed,
 * or the group-level summary hides exactly the thing colour-by exists to
 * surface.
 *
 * - **Exposure** / **oldest lifecycle stage**: worst-of-children — any
 *   exposed descendant makes the whole group `exposed`; the group's own
 *   "oldest stage" is the most-advanced stage among any descendant's own
 *   (already worst-of-its-own-supporting-systems) stage. Same reasoning
 *   `tileColourFor`'s per-tile version already uses, just maximised over
 *   more than one capability.
 * - **Coverage**: fraction-supported, not worst-of-children — "0 of 3
 *   capabilities have a supporting system" is a real, different fact
 *   from "1 of 3", and averaging away *how many* would lose it. `warn`
 *   only when literally none of the group's descendants have a
 *   supporting system (mirrors the per-tile rule: a count of zero is the
 *   one coverage value that's ever `warn`). The fraction itself is never
 *   this chip's own label (bug found live: "3/6 capabilities supported"
 *   rendered twice in the same L1 header) — `computeCapabilityRollup`'s
 *   own `supportedCapabilityCount`/`totalCapabilityCount` already put the
 *   identical fraction, unconditionally, in the group header's own "N
 *   capabilities · M systems · X/Y supported" line
 *   (`capabilityRollup.ts`'s module comment), so this label states the
 *   tone in words instead.
 *
 * `descendantCapabilityIds` is the caller's own flattened L2+L3 id list
 * (`L1ColumnView` already has `column.l2`/each card's `l3`) — kept a
 * plain id list rather than this file taking a dependency on `layout.ts`'s
 * tree shape.
 */
export function aggregateTileColourFor(mode: ColourByMode, descendantCapabilityIds: readonly UUID[], supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>, replacedIds?: ReadonlySet<UUID>): TileColour {
  if (descendantCapabilityIds.length === 0) return { tone: undefined, label: undefined };
  switch (mode) {
    case 'none':
      return { tone: undefined, label: undefined };
    case 'metric:supportingSystemCount': {
      const supportedCount = descendantCapabilityIds.filter((id) => supportingSystemIds(id, supportsEdges).length > 0).length;
      return { tone: supportedCount === 0 ? 'warn' : 'neutral', label: supportedCount === 0 ? 'no capabilities supported' : 'capabilities supported' };
    }
    case 'metric:oldestLifecycleStage': {
      let worst: LifecycleStatus | null = null;
      for (const id of descendantCapabilityIds) {
        const stage = oldestLifecycleStage(id, supportsEdges, systemsById);
        if (stage !== null && (worst === null || LIFECYCLE_ORDER[stage] > LIFECYCLE_ORDER[worst])) worst = stage;
      }
      return worst === null ? { tone: undefined, label: undefined } : { tone: LIFECYCLE_TONE[worst], label: worst };
    }
    case 'metric:lifecycleExposure': {
      const exposed = descendantCapabilityIds.some((id) => lifecycleExposure(id, supportsEdges, systemsById, new Date(), replacedIds));
      return exposed ? { tone: 'danger', label: 'end of life' } : { tone: undefined, label: undefined };
    }
    case 'metric:criticality': {
      let worst: Criticality | null = null;
      for (const id of descendantCapabilityIds) {
        const criticality = worstCriticality(id, supportsEdges, systemsById);
        if (criticality !== null && (worst === null || CRITICALITY_ORDER[criticality] > CRITICALITY_ORDER[worst])) worst = criticality;
      }
      return worst === null ? { tone: undefined, label: undefined } : { tone: CRITICALITY_TONE[worst], label: worst };
    }
    case 'metric:otShare': {
      let ot = 0;
      let total = 0;
      for (const id of descendantCapabilityIds) {
        const share = otShareOf(id, supportsEdges, systemsById);
        ot += share.ot;
        total += share.total;
      }
      return ot === 0 ? { tone: undefined, label: undefined } : { tone: 'neutral', label: `${String(ot)}/${String(total)} systems OT` };
    }
    case 'metric:fitForPurpose': {
      const worst = worstFitForPurposeAcross(descendantCapabilityIds, supportsEdges);
      return worst === null ? { tone: undefined, label: undefined } : { tone: FIT_FOR_PURPOSE_TONE[worst], label: worst };
    }
    case 'metric:disposition':
      return dispositionColour(worstDisposition(descendantCapabilityIds.map((id) => worstDispositionOf(id, supportsEdges, systemsById))));
  }
}

/**
 * Sprint U4-1 C4's "default colour-by": exposure for a director, coverage
 * for an architect; "none" only while the model has no systems at all
 * (`hasSystems` — `src/db/capabilityMap.ts`'s `hasAnySystem`, the real
 * model-wide answer, not `useCapabilityMap.ts`'s own `systemsById`, which
 * only ever holds systems that already support *some* capability — a
 * model can have real systems and still show 0 there); a saved choice
 * (`user_preferences.capability_map_colour_by`, `saved` here) always
 * wins over both, since "remember last choice per user" is the whole
 * point of persisting it at all — this only ever runs the default logic
 * for the *first* time a person opens a map, or after using it on a
 * model with no systems yet.
 */
export function resolveDefaultColourBy(saved: ColourByMode | null, homeMode: HomeMode, hasSystems: boolean): ColourByMode {
  if (saved !== null) return saved;
  if (!hasSystems) return 'none';
  return homeMode === 'director' ? 'metric:lifecycleExposure' : 'metric:supportingSystemCount';
}
