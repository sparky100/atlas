/**
 * Fit-for-purpose and lifecycle-exposure reads, moved out of
 * `src/ui/capabilityMap/metrics.ts` (which keeps re-exporting them) so the
 * Portfolio row builder and the model tools (ADR-028) can use them without
 * importing `src/ui`. Pure.
 */
import type { FitForPurpose, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { monthsUntil, STALE_AFTER_MONTHS } from '../../contracts/thresholds';
import { attributesRecord } from './attributesRecord';
import { FIT_FOR_PURPOSE_ORDER } from './fitForPurpose';

/** A `supports` edge's own `fitForPurpose` rating, or `null` if unset/unrecognised. Exported for the Portfolio view's own system-side worst-fit read (`worstFitForPurposeOfSupporter` below) — the identical leaf-level read `worstFitForPurpose` already makes capability-side. */
export function fitForPurposeOf(edge: RelationshipsHeadRow): FitForPurpose | null {
  const value = attributesRecord(edge.attributes).fitForPurpose;
  return typeof value === 'string' && value in FIT_FOR_PURPOSE_ORDER ? (value as FitForPurpose) : null;
}

/**
 * The mirror of `worstFitForPurpose`, keyed on the *supporting* element
 * (a system or a module container, `edge.from_element_id`) rather than the
 * capability it supports — the Portfolio view's own "fit (worst across
 * its supports edges)" column, since nothing before it needed a system's
 * own worst fit rather than a capability's. Same worst-of/unrated
 * semantics: an edge with no rating is skipped, and a supporter with
 * zero rated edges reads `null`, never a recorded value.
 */
export function worstFitForPurposeOfSupporter(supporterId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): FitForPurpose | null {
  let worst: FitForPurpose | null = null;
  for (const edge of supportsEdges) {
    if (edge.from_element_id !== supporterId) continue;
    const fit = fitForPurposeOf(edge);
    if (fit !== null && (worst === null || FIT_FOR_PURPOSE_ORDER[fit] > FIT_FOR_PURPOSE_ORDER[worst])) worst = fit;
  }
  return worst;
}

export function plannedEndOf(system: ElementsHeadRow): Date | null {
  const value = attributesRecord(system.attributes).plannedEnd;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `true` when any of `systems` has a `plannedEnd` falling within
 * `STALE_AFTER_MONTHS` of `now` — including one already overdue, which is
 * more exposed still, not less. The reusable core `lifecycleExposure`
 * delegates to (and that the decision page's "Trigger resolved" row,
 * `whatChangesRows.ts`, also calls directly against a system/container
 * concern's own singleton system list) — see the module comment for why
 * "no planned replacement" isn't (yet) a separate check.
 */
export function systemsExposedByLifecycle(systems: readonly ElementsHeadRow[], now: Date = new Date()): boolean {
  for (const system of systems) {
    const plannedEnd = plannedEndOf(system);
    if (plannedEnd !== null && monthsUntil(plannedEnd, now) <= STALE_AFTER_MONTHS) return true;
  }
  return false;
}

/** `true` when at least one of `systems` has a recorded `plannedEnd` — `false` means exposure can't be determined either way (no signal), as distinct from a genuine "not exposed" read. */
export function hasLifecycleExposureData(systems: readonly ElementsHeadRow[]): boolean {
  return systems.some((system) => plannedEndOf(system) !== null);
}
