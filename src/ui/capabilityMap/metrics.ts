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
 * Three metrics, matching the director door's own health-chip vocabulary
 * (§3.1) rather than a fourth, invented one:
 *
 * - **Coverage** (`supportingSystemCount`): §3.1's own gap — a capability
 *   with no `supports` edge at all reads `warn`; any real count reads
 *   plain `neutral` regardless of magnitude, since a *larger* count is not
 *   "worse" (or "better") in any sense this product can source. The
 *   literal number is always shown as text alongside the colour either
 *   way (Chip's own rule: status is never colour-only, §6.3, §8.4, §8.7).
 * - **Oldest lifecycle stage** (`oldestLifecycleStage`): the most-advanced
 *   `lifecycleStatus` among supporting systems, using the exact tone
 *   mapping lifecycle chips already use everywhere else.
 * - **Exposure** (`lifecycleExposure`): §3.1's "lifecycle exposure" gap —
 *   a supporting system whose `plannedEnd` falls within
 *   `STALE_AFTER_MONTHS` (reusing the one global threshold, not a second
 *   one invented for this) and has no planned replacement. "No planned
 *   replacement" is UI-principles §10 decision 4's own definition — a
 *   retract delta in the same approved change — which needs the review
 *   queue/decision machinery Sprint U2 doesn't build; until that exists,
 *   nothing can ever record a planned replacement, so that half of the
 *   condition is vacuously true today. This is a documented, honest
 *   simplification (the condition narrows correctly once replacement
 *   tracking exists), not a silently wrong implementation.
 *
 * `isExternal` was considered and dropped: a capability isn't external,
 * only (some of) its supporting systems are, and "any support system is
 * external" versus "most are" are different, both defensible readings
 * that would need their own design pass — not a natural third option
 * alongside two metrics that need no such judgment call.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { LifecycleStatus, UUID } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';
import { STALE_AFTER_MONTHS } from '../../contracts/thresholds';
import { attributesRecord } from '../elements/attributesRecord';
import { LIFECYCLE_ORDER, LIFECYCLE_TONE } from '../elements/lifecycleTone';

export type ColourByMode = 'none' | 'metric:supportingSystemCount' | 'metric:oldestLifecycleStage' | 'metric:lifecycleExposure';

export const COLOUR_BY_OPTIONS: { value: ColourByMode; label: string }[] = [
  { value: 'metric:supportingSystemCount', label: 'Coverage (supporting-system count)' },
  { value: 'metric:oldestLifecycleStage', label: 'Oldest lifecycle stage' },
  { value: 'metric:lifecycleExposure', label: 'Lifecycle exposure' },
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
export function oldestLifecycleStage(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: Map<UUID, ElementsHeadRow>): LifecycleStatus | null {
  let oldest: LifecycleStatus | null = null;
  for (const systemId of supportingSystemIds(capabilityId, supportsEdges)) {
    const status = systemsById.get(systemId);
    if (!status) continue;
    const lifecycle = lifecycleStatusOf(status);
    if (lifecycle && (oldest === null || LIFECYCLE_ORDER[lifecycle] > LIFECYCLE_ORDER[oldest])) oldest = lifecycle;
  }
  return oldest;
}

function plannedEndOf(system: ElementsHeadRow): Date | null {
  const value = attributesRecord(system.attributes).plannedEnd;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole months from `now` until `date` — negative once `date` is in the past. The mirror of thresholds.ts's `monthsSince` (which measures the other direction), kept local since nothing else needs a "months in the future" reading. */
function monthsUntil(date: Date, now: Date): number {
  const months = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
  return date.getDate() < now.getDate() ? months - 1 : months;
}

/**
 * `true` when any supporting system's `plannedEnd` falls within
 * `STALE_AFTER_MONTHS` of `now` — including one already overdue, which is
 * more exposed still, not less. See the module comment for why "no
 * planned replacement" isn't (yet) a separate check.
 */
export function lifecycleExposure(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: Map<UUID, ElementsHeadRow>, now: Date = new Date()): boolean {
  for (const systemId of supportingSystemIds(capabilityId, supportsEdges)) {
    const system = systemsById.get(systemId);
    if (!system) continue;
    const plannedEnd = plannedEndOf(system);
    if (plannedEnd !== null && monthsUntil(plannedEnd, now) <= STALE_AFTER_MONTHS) return true;
  }
  return false;
}

/** The tone+label a tile should show for the selected colour-by mode — `mode: 'none'` always returns no tone and no label. */
export function tileColourFor(mode: ColourByMode, capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: Map<UUID, ElementsHeadRow>): TileColour {
  switch (mode) {
    case 'none':
      return { tone: undefined, label: undefined };
    case 'metric:supportingSystemCount': {
      const count = supportingSystemIds(capabilityId, supportsEdges).length;
      return { tone: count === 0 ? 'warn' : 'neutral', label: `${String(count)} supporting system${count === 1 ? '' : 's'}` };
    }
    case 'metric:oldestLifecycleStage': {
      const stage = oldestLifecycleStage(capabilityId, supportsEdges, systemsById);
      return stage === null ? { tone: undefined, label: undefined } : { tone: LIFECYCLE_TONE[stage], label: stage };
    }
    case 'metric:lifecycleExposure': {
      const exposed = lifecycleExposure(capabilityId, supportsEdges, systemsById);
      return exposed ? { tone: 'danger', label: 'exposed' } : { tone: undefined, label: undefined };
    }
  }
}
