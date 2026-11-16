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
 * The ids of every element with a live `replaces` edge pointing at it —
 * `to_element_id`, the retiring side ("B replaces A" is `from: B, to: A`,
 * ADR-001 amendment). Non-`replaces` edges in `edges` are ignored, so a
 * caller can pass a mixed list. Pure.
 */
export function replacedElementIds(edges: readonly RelationshipsHeadRow[]): Set<UUID> {
  const ids = new Set<UUID>();
  for (const edge of edges) {
    if (edge.relationship_type === 'replaces') ids.add(edge.to_element_id);
  }
  return ids;
}

/**
 * `true` once `element`'s own `plannedEnd` has been reached (`plannedEnd <= now`),
 * or its parent platform's has (a module goes with its platform, the same
 * rule `plannedFuture.ts` applies to a future view). No recorded date, or an
 * unreadable one, reads `false` — never "ended".
 */
export function hasReachedPlannedEnd(element: ElementsHeadRow, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): boolean {
  const own = plannedEndOf(element);
  if (own !== null && own.getTime() <= now.getTime()) return true;
  const parent = element.parent_id !== null ? elementsById.get(element.parent_id) : undefined;
  const parentEnd = parent ? plannedEndOf(parent) : null;
  return parentEnd !== null && parentEnd.getTime() <= now.getTime();
}

/** The element's own `introduced` date, or `null` if none is recorded or it is unreadable. */
export function introducedOf(element: ElementsHeadRow): Date | null {
  const value = attributesRecord(element.attributes).introduced;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `true` while `element`'s own `introduced` date, or its parent platform's, is
 * still ahead. No recorded or readable date reads `false` — never "not yet".
 */
export function hasNotYetBeenIntroduced(element: ElementsHeadRow, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): boolean {
  const own = introducedOf(element);
  if (own !== null && own.getTime() > now.getTime()) return true;
  const parent = element.parent_id !== null ? elementsById.get(element.parent_id) : undefined;
  const parentStart = parent ? introducedOf(parent) : null;
  return parentStart !== null && parentStart.getTime() > now.getTime();
}

/** Where an element sits in time: not live yet, live, or gone. */
export type LifecycleState = 'planned' | 'active' | 'retired';

/**
 * What an element's dates alone say (`introduced`, `plannedEnd`, a module
 * following its platform), ignoring any recorded status. The lifecycle
 * status/date mismatch check compares this with the status someone typed, so
 * the two can never read the dates differently.
 */
export function lifecycleStateFromDates(element: ElementsHeadRow, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): LifecycleState {
  if (hasNotYetBeenIntroduced(element, elementsById, now)) return 'planned';
  return hasReachedPlannedEnd(element, elementsById, now) ? 'retired' : 'active';
}

/**
 * The one start/end rule for systems, platforms and modules. An element is
 * `planned` while its `introduced` date (or its parent platform's) is still
 * ahead, `retired` once its `plannedEnd` (or its platform's) has been reached
 * — or when it is marked `retired` and has no end date at all (the status is
 * then the only fact there is) — and `active` otherwise. A missing or
 * unreadable date never moves anything out of `active`. A marked-`retired`
 * element that still has a future end date stays active until that date: the
 * date wins. Pure: `now` is always the caller's.
 */
export function lifecycleStateOf(element: ElementsHeadRow, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): LifecycleState {
  const byDates = lifecycleStateFromDates(element, elementsById, now);
  if (byDates !== 'active') return byDates;
  const parent = element.parent_id !== null ? elementsById.get(element.parent_id) : undefined;
  for (const e of parent ? [element, parent] : [element]) {
    if (attributesRecord(e.attributes).lifecycleStatus === 'retired' && plannedEndOf(e) === null) return 'retired';
  }
  return 'active';
}

/** `true` when `element` is neither planned nor retired. Unknown elements are the caller's to keep. */
export function isInForce(element: ElementsHeadRow, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): boolean {
  return lifecycleStateOf(element, elementsById, now) === 'active';
}

/**
 * Relationships still "in force": a link is in force only when both ends are
 * (an integration doesn't exist until it is live, and a retired system's
 * links stop counting with it). An end that isn't in `elementsById` (a
 * capability, an actor, anything unknown) is kept — only a dated system or
 * module can take a link out.
 */
export function edgesInForce(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): RelationshipsHeadRow[] {
  return edges.filter((edge) => {
    const from = elementsById.get(edge.from_element_id);
    const to = elementsById.get(edge.to_element_id);
    return (!from || isInForce(from, elementsById, now)) && (!to || isInForce(to, elementsById, now));
  });
}

/**
 * The `supports` edges still "in force": those whose supporting system or
 * module is active (introduced, and not past its end). Retire with a
 * replacement copies the capability links to the replacement and keeps the
 * old ones, so before the end date both systems support the capability (the
 * truth during a migration), and from the end date the old system stops
 * counting; a planned system doesn't count until introduced. An edge whose
 * supporter isn't in `elementsById` is kept — unknown is never "ended".
 */
export function supportsEdgesInForce(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>, now: Date = new Date()): RelationshipsHeadRow[] {
  return edges.filter((edge) => {
    if (edge.relationship_type !== 'supports') return true;
    const supporter = elementsById.get(edge.from_element_id);
    return !supporter || isInForce(supporter, elementsById, now);
  });
}

/**
 * `true` when any of `systems` has a `plannedEnd` falling within
 * `STALE_AFTER_MONTHS` of `now` — including one already overdue, which is
 * more exposed still, not less — **and** has no recorded replacement.
 * "No planned replacement" (ADR-001 amendment, `replaces`) reads a real
 * fact: a system in `replacedIds` (the retiring side of a live `replaces`
 * edge, `replacedElementIds`) never counts as exposed, however near or
 * past its own `plannedEnd`. Existence-only — the replacement's own
 * lifecycle is deliberately not considered. `replacedIds` is optional so a caller that hasn't loaded
 * `replaces` edges keeps the plain `plannedEnd` reading. The reusable core
 * `lifecycleExposure` delegates to (and that the decision page's "Trigger
 * resolved" row, `whatChangesRows.ts`, also calls directly against a
 * system/container concern's own singleton system list).
 */
export function systemsExposedByLifecycle(systems: readonly ElementsHeadRow[], now: Date = new Date(), replacedIds?: ReadonlySet<UUID>): boolean {
  for (const system of systems) {
    if (replacedIds?.has(system.element_id)) continue;
    const plannedEnd = plannedEndOf(system);
    if (plannedEnd !== null && monthsUntil(plannedEnd, now) <= STALE_AFTER_MONTHS) return true;
  }
  return false;
}

/** `true` when at least one of `systems` has a recorded `plannedEnd` — `false` means exposure can't be determined either way (no signal), as distinct from a genuine "not exposed" read. */
export function hasLifecycleExposureData(systems: readonly ElementsHeadRow[]): boolean {
  return systems.some((system) => plannedEndOf(system) !== null);
}
