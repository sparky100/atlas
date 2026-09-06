/**
 * The capability map's colour-by modes. Nothing here is specified in
 * UI-principles.md/SPEC beyond the two names the brief gives
 * ("supporting-system count", "oldest lifecycle stage") — both are
 * deliberately fact-derived counts/states, never an opinion score: ADR-000
 * preface #6 and UI-principles §9 rule out a maturity heat-map precisely
 * because "a maturity score would be an opinion without a source" (§9),
 * and every tone below traces to a real, visible fact (a real
 * `supports` edge, a real `lifecycleStatus`/`isExternal` value on a real
 * system) — never a blended or weighted score.
 *
 * "Colour by attribute" is scoped to `isExternal` — the one System
 * attribute that's both boolean (colour-suitable without inventing a new
 * palette) and not already covered by a metric mode; `lifecycleStatus`
 * driving "oldest lifecycle stage" already covers that attribute's colour
 * story, so offering it twice under a different name would be padding,
 * not a second real option. `vendor` is free text — too high-cardinality
 * for a fixed, colour-blind-safe palette — so it's left out rather than
 * given an arbitrary hash-to-colour treatment no one asked for.
 *
 * "Supporting-system count" deliberately does not become a five-tone
 * heat-map: a *larger* count is not "worse" (or "better") in any sense
 * this product can source, so its only tone distinction is coverage
 * itself — zero supporting systems (§3.1's "Coverage" health gap: nothing
 * runs this) reads `warn`; any real count reads plain `neutral` regardless
 * of magnitude. The literal number is always shown as text alongside the
 * colour either way (Chip's own rule: status is never colour-only, §6.3,
 * §8.4, §8.7).
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { LifecycleStatus, UUID } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';
import { attributesRecord } from '../elements/attributesRecord';
import { LIFECYCLE_ORDER, LIFECYCLE_TONE } from '../elements/lifecycleTone';

export type ColourByMode = 'none' | 'attribute:isExternal' | 'metric:supportingSystemCount' | 'metric:oldestLifecycleStage';

export const COLOUR_BY_OPTIONS: { value: ColourByMode; label: string; group: 'Attribute' | 'Metric' }[] = [
  { value: 'attribute:isExternal', label: 'External (supporting systems)', group: 'Attribute' },
  { value: 'metric:supportingSystemCount', label: 'Supporting-system count', group: 'Metric' },
  { value: 'metric:oldestLifecycleStage', label: 'Oldest lifecycle stage', group: 'Metric' },
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

/** `true` when a strict majority of supporting systems are external, `false` for a strict majority internal, `null` for no supporting systems or an exact tie. */
export function mostlyExternal(capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: Map<UUID, ElementsHeadRow>): boolean | null {
  let external = 0;
  let internal = 0;
  for (const systemId of supportingSystemIds(capabilityId, supportsEdges)) {
    const system = systemsById.get(systemId);
    if (!system) continue;
    if (attributesRecord(system.attributes).isExternal === true) external++;
    else internal++;
  }
  if (external === 0 && internal === 0) return null;
  if (external === internal) return null;
  return external > internal;
}

/** The tone+label a tile should show for the selected colour-by mode — `mode: 'none'` always returns no tone and no label. */
export function tileColourFor(mode: ColourByMode, capabilityId: UUID, supportsEdges: readonly RelationshipsHeadRow[], systemsById: Map<UUID, ElementsHeadRow>): TileColour {
  switch (mode) {
    case 'none':
      return { tone: undefined, label: undefined };
    case 'attribute:isExternal': {
      const external = mostlyExternal(capabilityId, supportsEdges, systemsById);
      return external === true ? { tone: 'neutral', label: 'mostly external' } : { tone: undefined, label: undefined };
    }
    case 'metric:supportingSystemCount': {
      const count = supportingSystemIds(capabilityId, supportsEdges).length;
      return { tone: count === 0 ? 'warn' : 'neutral', label: `${String(count)} supporting system${count === 1 ? '' : 's'}` };
    }
    case 'metric:oldestLifecycleStage': {
      const stage = oldestLifecycleStage(capabilityId, supportsEdges, systemsById);
      return stage === null ? { tone: undefined, label: undefined } : { tone: LIFECYCLE_TONE[stage], label: stage };
    }
  }
}
