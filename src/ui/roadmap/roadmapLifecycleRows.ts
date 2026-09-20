/**
 * F5's own "rows by capability or system; time horizontal; lifecycle bars
 * from `introduced`/`plannedEnd`/`supportEndsAt`" (docs/prompts/atlas-prompt-pack.md).
 * Lifecycle dates live on systems and containers only — `CapabilityAttributes`
 * has none of the three (src/contracts/delta.ts) — so a row's own bar is
 * always a system's; capabilities are the grouping, not the bar, the same
 * "capability lane, system tile" shape Landscape already established
 * (`src/ui/landscape/layout.ts`'s own module comment).
 *
 * Grouping reuses `l1AncestorOf` (src/ui/elements/capabilityDepth.ts),
 * walking a system's own primary `supports` edge to its level-1 capability
 * — the same rollup target every other level-1 surface in this app already
 * uses (capabilityRollup.ts, metrics.ts's aggregate colour-by). Unlike
 * Landscape's own `groupSystemsByLane`, this doesn't fall back to
 * "most-recently-added" when no edge is marked primary — a system with
 * several supports edges and none marked primary groups under
 * `UNASSIGNED_GROUP_KEY` here, a deliberately simpler rule for a first
 * pass (Landscape's own fallback exists for canvas placement, where every
 * system needs *some* lane; a roadmap row has no such placement
 * requirement).
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';
import { l1AncestorOf } from '../elements/capabilityDepth';

/** A value no real element id can ever equal (UUIDs never start with `$`) — the same sentinel shape `layout.ts`'s own `UNASSIGNED_LANE_KEY` uses, rather than a type-level union with `UUID` (itself a plain `string` alias, so TS can't distinguish a literal from it anyway). */
export const UNASSIGNED_GROUP_KEY = '$unassigned';

export interface RoadmapLifecycleBar {
  systemId: UUID;
  name: string;
  /** `introduced` — the bar's own start; `undefined` when not recorded (the bar then has no left edge, per rule 7: an absent fact is shown absent, never defaulted to "today"). */
  introduced: string | undefined;
  /** `plannedEnd` — the estate's own planned decommission date; the bar's right edge. */
  plannedEnd: string | undefined;
  /** `supportEndsAt` — vendor support end, a distinct fact from `plannedEnd` (delta.ts's own doc comment) — drawn as its own marker on the bar, never merged into the same date. */
  supportEndsAt: string | undefined;
  criticality: string | undefined;
  lifecycleStatus: string | undefined;
  /** Every actor with a live `owns` edge onto this system, any role — the roadmap's own owner filter matches against this, not a specific role (unlike `ownersByRole.ts`'s Inspector-panel grouping, which cares which role each owner holds). */
  ownerActorIds: UUID[];
}

export interface RoadmapCapabilityGroup {
  /** A capability id, or `UNASSIGNED_GROUP_KEY`. */
  key: string;
  /** `undefined` only for `UNASSIGNED_GROUP_KEY`. */
  capability: ElementsHeadRow | undefined;
  bars: RoadmapLifecycleBar[];
}

function primarySupportsCapabilityId(systemId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): UUID | null {
  for (const edge of supportsEdges) {
    if (edge.from_element_id !== systemId) continue;
    if (attributesRecord(edge.attributes).role === 'primary') return edge.to_element_id;
  }
  return null;
}

function ownerActorIdsOf(systemId: UUID, ownsEdges: readonly RelationshipsHeadRow[]): UUID[] {
  return ownsEdges.filter((edge) => edge.to_element_id === systemId).map((edge) => edge.from_element_id);
}

/** `undefined` when a system carries none of the three lifecycle dates — nothing for a timeline to draw, so it's dropped rather than shown as an empty bar (rule 7). */
function lifecycleBarOf(system: ElementsHeadRow, ownsEdges: readonly RelationshipsHeadRow[]): RoadmapLifecycleBar | null {
  const attrs = attributesRecord(system.attributes);
  const introduced = typeof attrs.introduced === 'string' ? attrs.introduced : undefined;
  const plannedEnd = typeof attrs.plannedEnd === 'string' ? attrs.plannedEnd : undefined;
  const supportEndsAt = typeof attrs.supportEndsAt === 'string' ? attrs.supportEndsAt : undefined;
  if (introduced === undefined && plannedEnd === undefined && supportEndsAt === undefined) return null;
  return {
    systemId: system.element_id,
    name: system.name,
    introduced,
    plannedEnd,
    supportEndsAt,
    criticality: typeof attrs.criticality === 'string' ? attrs.criticality : undefined,
    lifecycleStatus: typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : undefined,
    ownerActorIds: ownerActorIdsOf(system.element_id, ownsEdges),
  };
}

/**
 * @param systems Every system in scope (already filtered by whatever ref/branch the caller is viewing).
 * @param supportsEdges Every live `supports` edge in scope — used only to find each system's own primary capability for grouping, not for the bar's own dates.
 * @param ownsEdges Every live `owns` edge in scope — used only for the owner filter (any role; see `RoadmapLifecycleBar.ownerActorIds`).
 * @param capabilitiesById Every capability in scope, keyed by id — `l1AncestorOf`'s own input shape.
 */
export function groupRoadmapLifecycleBars(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
): RoadmapCapabilityGroup[] {
  const groups = new Map<string, RoadmapCapabilityGroup>();

  for (const system of systems) {
    const bar = lifecycleBarOf(system, ownsEdges);
    if (!bar) continue;

    const primaryCapabilityId = primarySupportsCapabilityId(system.element_id, supportsEdges);
    const l1 = primaryCapabilityId !== null ? l1AncestorOf(primaryCapabilityId, capabilitiesById) : null;
    const key = l1?.element_id ?? UNASSIGNED_GROUP_KEY;

    const group = groups.get(key) ?? { key, capability: l1 ?? undefined, bars: [] };
    group.bars.push(bar);
    groups.set(key, group);
  }

  for (const group of groups.values()) group.bars.sort((a, b) => a.name.localeCompare(b.name));

  return [...groups.values()].sort((a, b) => {
    if (a.key === UNASSIGNED_GROUP_KEY) return 1;
    if (b.key === UNASSIGNED_GROUP_KEY) return -1;
    return (a.capability?.name ?? '').localeCompare(b.capability?.name ?? '');
  });
}
