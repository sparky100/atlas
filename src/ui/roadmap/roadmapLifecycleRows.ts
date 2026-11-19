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
 * uses (capabilityRollup.ts, metrics.ts's aggregate colour-by). When no edge is
 * marked primary it falls back to the system's other supports links
 * (`groupingCapabilityId`), so `UNASSIGNED_GROUP_KEY` holds only systems
 * that support no level-1-reachable capability at all.
 *
 * F6 Step 6 (ADR-023) adds a second grouping mode, `groupBarsByValueStream`:
 * the same bars, grouped by the value stream(s) a system's primary
 * capability enables (system → primary `supports` capability → `enables`
 * → stage → stream) rather than by capability. A system whose primary
 * capability enables stages in two streams appears in *both* groups (the
 * one bar object repeated — bars are read-only), and a system reachable
 * from no stream falls into `UNASSIGNED_GROUP_KEY`, exactly as the
 * capability grouping does when there is no primary edge.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';
import { l1AncestorOf } from '../elements/capabilityDepth';
import type { LifecycleTagProps } from '../components/LifecycleTag/LifecycleTag';
import { lifecycleTagFor } from '../components/LifecycleTag/lifecycleTagFor';
import type { RoadmapProjectBar } from './roadmapProjectBars';

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
  /** The bar's own level-1 capability id (via its primary `supports` edge), or `undefined` when it has none — the capability *filter facet* matches against this rather than the group key, so it behaves identically under capability and value-stream grouping. */
  capabilityKey?: UUID;
  /** Every capability this system supports through any `supports` edge (main or also), plus each one's ancestors — so filtering by a sub-capability, or by a capability the system only also supports, still finds it. */
  supportedCapabilityIds?: UUID[];
  /** Set when the system is planned (not live yet) or retired today: the Roadmap always shows it, marked with the shared tag. */
  lifecycleTag?: LifecycleTagProps;
}

export interface RoadmapGroup {
  /** A capability id, a value-stream id, or `UNASSIGNED_GROUP_KEY`. */
  key: string;
  /** The group's display name — the capability/stream's own name, or a plain "not linked" label for `UNASSIGNED_GROUP_KEY`. */
  label: string;
  /** The group header's element-page link, or `null` for `UNASSIGNED_GROUP_KEY` (which has no page). */
  href: string | null;
  bars: RoadmapLifecycleBar[];
  /** Plan A3: open projects serving this capability domain, drawn above the systems — only ever set on the "By capability" grouping (`attachProjectBars`). */
  projectBars?: RoadmapProjectBar[];
}

type ElementHref = (id: UUID) => string;

function primarySupportsCapabilityId(systemId: UUID, supportsEdges: readonly RelationshipsHeadRow[]): UUID | null {
  for (const edge of supportsEdges) {
    if (edge.from_element_id !== systemId) continue;
    if (attributesRecord(edge.attributes).role === 'primary') return edge.to_element_id;
  }
  return null;
}

/**
 * The capability a system is grouped under: its Main (`primary`) supports
 * link, else — so a system that only *also* supports a capability is not
 * called "unassigned" — the first other supports link that reaches a
 * level-1 capability (ordered by relationship id, so the choice is stable).
 */
function groupingCapabilityId(systemId: UUID, supportsEdges: readonly RelationshipsHeadRow[], capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): UUID | null {
  const primary = primarySupportsCapabilityId(systemId, supportsEdges);
  if (primary !== null) return primary;
  const others = supportsEdges.filter((edge) => edge.from_element_id === systemId).sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  for (const edge of others) {
    if (l1AncestorOf(edge.to_element_id, capabilitiesById) !== null) return edge.to_element_id;
  }
  return null;
}

/** One plain line under a bar's name saying what its ends mean, so a bar with a single date doesn't read as an unexplained stripe. */
export function roadmapBarCaption(bar: Pick<RoadmapLifecycleBar, 'introduced' | 'plannedEnd' | 'supportEndsAt'>): string {
  const parts: string[] = [];
  parts.push(bar.introduced !== undefined ? `From ${bar.introduced}` : 'Start date not recorded');
  parts.push(bar.plannedEnd !== undefined ? `to ${bar.plannedEnd}` : 'no end date planned');
  const range = `${parts[0] ?? ''}, ${parts[1] ?? ''}`;
  return bar.supportEndsAt !== undefined ? `${range} · vendor support ends ${bar.supportEndsAt}` : range;
}

function ownerActorIdsOf(systemId: UUID, ownsEdges: readonly RelationshipsHeadRow[]): UUID[] {
  return ownsEdges.filter((edge) => edge.to_element_id === systemId).map((edge) => edge.from_element_id);
}

/** `undefined` when a system carries none of the three lifecycle dates — nothing for a timeline to draw, so it's dropped rather than shown as an empty bar (rule 7). */
function supportedCapabilityIdsOf(systemId: UUID, supportsEdges: readonly RelationshipsHeadRow[], capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): UUID[] {
  const ids = new Set<UUID>();
  for (const edge of supportsEdges) {
    if (edge.from_element_id !== systemId) continue;
    let current: ElementsHeadRow | undefined = capabilitiesById.get(edge.to_element_id);
    // Walk up through parents; the visited check also guards against a malformed parent cycle.
    while (current !== undefined && !ids.has(current.element_id)) {
      ids.add(current.element_id);
      current = current.parent_id === null ? undefined : capabilitiesById.get(current.parent_id);
    }
  }
  return [...ids];
}

function optionalTag(tag: LifecycleTagProps | undefined): { lifecycleTag?: LifecycleTagProps } {
  return tag ? { lifecycleTag: tag } : {};
}

function lifecycleBarOf(system: ElementsHeadRow, ownsEdges: readonly RelationshipsHeadRow[], supportsEdges: readonly RelationshipsHeadRow[], capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): RoadmapLifecycleBar | null {
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
    supportedCapabilityIds: supportedCapabilityIdsOf(system.element_id, supportsEdges, capabilitiesById),
    ...optionalTag(lifecycleTagFor(system, null)),
  };
}

/** Adds `bar` to the group identified by `key`, creating it on first use — shared by both grouping modes so the "unassigned last, alphabetical otherwise" ordering is defined once. */
function pushBar(groups: Map<string, RoadmapGroup>, key: string, label: string, href: string | null, bar: RoadmapLifecycleBar): void {
  const group = groups.get(key) ?? { key, label, href, bars: [] };
  group.bars.push(bar);
  groups.set(key, group);
}

/** Bars sorted by name within each group, groups sorted `UNASSIGNED` last then alphabetically by label. */
function finishGroups(groups: Map<string, RoadmapGroup>): RoadmapGroup[] {
  for (const group of groups.values()) group.bars.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups.values()].sort((a, b) => {
    if (a.key === UNASSIGNED_GROUP_KEY) return 1;
    if (b.key === UNASSIGNED_GROUP_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * @param systems Every system and module in scope (`roadmapModules.ts`'s own `systemsAndModulesFor`; already filtered by whatever ref/branch the caller is viewing).
 * @param supportsEdges Every live `supports` edge in scope — used only to find each system's own primary capability for grouping, not for the bar's own dates.
 * @param ownsEdges Every live `owns` edge in scope — used only for the owner filter (any role; see `RoadmapLifecycleBar.ownerActorIds`).
 * @param capabilitiesById Every capability in scope, keyed by id — `l1AncestorOf`'s own input shape.
 * @param elementHref Builds a group header's element-page link from its id.
 */
export function groupRoadmapLifecycleBars(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
  elementHref: ElementHref,
): RoadmapGroup[] {
  const groups = new Map<string, RoadmapGroup>();

  for (const system of systems) {
    const bar = lifecycleBarOf(system, ownsEdges, supportsEdges, capabilitiesById);
    if (!bar) continue;

    const primaryCapabilityId = groupingCapabilityId(system.element_id, supportsEdges, capabilitiesById);
    const l1 = primaryCapabilityId !== null ? l1AncestorOf(primaryCapabilityId, capabilitiesById) : null;
    if (l1 !== null) bar.capabilityKey = l1.element_id;
    const key = l1?.element_id ?? UNASSIGNED_GROUP_KEY;
    pushBar(groups, key, l1?.name ?? 'Not linked to a capability', l1 ? elementHref(l1.element_id) : null, bar);
  }

  return finishGroups(groups);
}

/**
 * F6 Step 6 (ADR-023 "Views" item 3): the same bars as
 * `groupRoadmapLifecycleBars`, grouped by value stream instead of
 * capability. Each system groups under every stream reachable from its
 * primary `supports` capability's own `enables` edges (capability →
 * stage, then the stage's parent stream) — so a system whose primary
 * capability enables stages in two streams appears in both. A system with
 * no primary capability, or whose primary capability enables no stage,
 * falls into `UNASSIGNED_GROUP_KEY`.
 *
 * @param valueStreamsById Every `value_stream` element in scope (streams
 *   and stages both), keyed by id — an `enables` edge's `to_element_id` is
 *   a stage, whose `parent_id` is its stream.
 * @param enablesEdges Every live `enables` edge in scope.
 */
export function groupBarsByValueStream(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
  valueStreamsById: ReadonlyMap<UUID, ElementsHeadRow>,
  enablesEdges: readonly RelationshipsHeadRow[],
  elementHref: ElementHref,
): RoadmapGroup[] {
  const groups = new Map<string, RoadmapGroup>();

  for (const system of systems) {
    const bar = lifecycleBarOf(system, ownsEdges, supportsEdges, capabilitiesById);
    if (!bar) continue;

    const primaryCapabilityId = groupingCapabilityId(system.element_id, supportsEdges, capabilitiesById);
    const l1 = primaryCapabilityId !== null ? l1AncestorOf(primaryCapabilityId, capabilitiesById) : null;
    if (l1 !== null) bar.capabilityKey = l1.element_id;

    const streamIds = new Set<UUID>();
    if (primaryCapabilityId !== null) {
      for (const edge of enablesEdges) {
        if (edge.from_element_id !== primaryCapabilityId) continue;
        const stage = valueStreamsById.get(edge.to_element_id);
        if (stage !== undefined && stage.parent_id !== null) streamIds.add(stage.parent_id);
      }
    }

    if (streamIds.size === 0) {
      pushBar(groups, UNASSIGNED_GROUP_KEY, 'Not in a value stream', null, bar);
      continue;
    }
    for (const streamId of streamIds) {
      const stream = valueStreamsById.get(streamId);
      pushBar(groups, streamId, stream?.name ?? 'Not in a value stream', stream ? elementHref(streamId) : null, bar);
    }
  }

  return finishGroups(groups);
}

/** F10 step 6: what `groupBarsByProject` needs to know of each project — its id, title and page link. */
export interface RoadmapProjectRef {
  id: UUID;
  title: string;
  href: string;
}

/** F10 step 6: the project-mode label for a system no project's change touches. */
export const NO_PROJECT_LABEL = 'No project';

/**
 * F10 step 6 (ADR-024 §6.3): a third grouping mode — the same bars,
 * grouped by the project(s) whose changes touch each system (a change's
 * own roadmap events: an add, a retire, or either end of a replacement).
 * A system touched by two projects' changes appears under both; one no
 * project's change touches falls under "No project".
 *
 * @param branchEvents Each eligible change's own roadmap events, with its branch (`branch.project_id`).
 * @param projectsById Every project on the model, keyed by id.
 */
export function groupBarsByProject(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
  branchEvents: readonly { branch: { project_id: UUID | null }; events: readonly ({ kind: 'add' | 'retire'; elementId: UUID } | { kind: 'replace'; fromSystemId: UUID; toSystemId: UUID })[] }[],
  projectsById: ReadonlyMap<UUID, RoadmapProjectRef>,
): RoadmapGroup[] {
  const projectsBySystem = new Map<UUID, Set<UUID>>();
  const note = (systemId: UUID, projectId: UUID) => {
    const set = projectsBySystem.get(systemId) ?? new Set<UUID>();
    set.add(projectId);
    projectsBySystem.set(systemId, set);
  };
  for (const { branch, events } of branchEvents) {
    if (branch.project_id === null || !projectsById.has(branch.project_id)) continue;
    for (const event of events) {
      if (event.kind === 'replace') {
        note(event.fromSystemId, branch.project_id);
        note(event.toSystemId, branch.project_id);
      } else {
        note(event.elementId, branch.project_id);
      }
    }
  }

  const groups = new Map<string, RoadmapGroup>();
  for (const system of systems) {
    const bar = lifecycleBarOf(system, ownsEdges, supportsEdges, capabilitiesById);
    if (!bar) continue;
    const primaryCapabilityId = groupingCapabilityId(system.element_id, supportsEdges, capabilitiesById);
    const l1 = primaryCapabilityId !== null ? l1AncestorOf(primaryCapabilityId, capabilitiesById) : null;
    if (l1 !== null) bar.capabilityKey = l1.element_id;

    const projectIds = projectsBySystem.get(system.element_id);
    if (!projectIds || projectIds.size === 0) {
      pushBar(groups, UNASSIGNED_GROUP_KEY, NO_PROJECT_LABEL, null, bar);
      continue;
    }
    for (const projectId of projectIds) {
      const project = projectsById.get(projectId);
      if (project) pushBar(groups, projectId, project.title, project.href, bar);
    }
  }
  return finishGroups(groups);
}
