/**
 * The landscape's layout algorithm (UI-principles.md §6.1/§6.4): systems in
 * swim-lanes by the capability they `support`, externals in a bottom lane,
 * positions within a lane are hints. Pure and deterministic — CLAUDE.md
 * rule 6 ("no Math.random in anything deterministic") — the same inputs
 * always produce the same output, with no seed to thread through, because
 * nothing here is random to begin with: grouping and ordering are total
 * orders over real data (capability name/id, system name/id), not a
 * randomised placement.
 *
 * Sprint U1 step 4a runs this synchronously on the main thread; moving it
 * into a Web Worker (UI-principles §8.6) is step 4b's job and does not
 * change this function's signature or behaviour, only where it's called
 * from.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';

export const EXTERNAL_LANE_KEY = '$external';
export const UNASSIGNED_LANE_KEY = '$unassigned';

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 48;
const NODE_GUTTER_X = 24;
const LANE_GUTTER_Y = 32;
const LANE_LABEL_HEIGHT = 28;
const PADDING = 32;

export interface LandscapeNodePosition {
  elementId: UUID;
  x: number;
  y: number;
}

export interface LandscapeLane {
  key: string;
  label: string;
  y: number;
  height: number;
}

export interface LandscapeLayout {
  nodes: LandscapeNodePosition[];
  lanes: LandscapeLane[];
  width: number;
  height: number;
}

function isExternal(system: ElementsHeadRow): boolean {
  return attributesRecord(system.attributes).isExternal === true;
}

/**
 * A system can support more than one capability (SPEC has no cardinality
 * limit on `supports`, unlike `owns`) — a swim lane is one bucket, so this
 * picks the supported capability that sorts first by (name, id), the same
 * deterministic tie-break used everywhere else in this function.
 */
function laneKeyFor(system: ElementsHeadRow, supportsBySystem: Map<UUID, UUID[]>, capabilitiesById: Map<UUID, ElementsHeadRow>): string {
  if (isExternal(system)) return EXTERNAL_LANE_KEY;
  const capabilityIds = supportsBySystem.get(system.element_id) ?? [];
  const capabilities = capabilityIds.map((id) => capabilitiesById.get(id)).filter((c): c is ElementsHeadRow => c !== undefined);
  if (capabilities.length === 0) return UNASSIGNED_LANE_KEY;
  // `reduce` without a seed is typed as returning `T`, not `T | undefined`,
  // on a non-empty array — which this is, checked above — so this picks
  // the alphabetically-first capability without an unchecked index access.
  const first = capabilities.reduce((min, c) => (byNameThenId(c, min) < 0 ? c : min));
  return first.element_id;
}

function byNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

function laneSortKey(key: string, capabilitiesById: Map<UUID, ElementsHeadRow>): [number, string] {
  // Capability lanes first (ordered by name), then unassigned, then
  // external always last — §6.1's "externals in a bottom lane" is literal.
  if (key === EXTERNAL_LANE_KEY) return [2, ''];
  if (key === UNASSIGNED_LANE_KEY) return [1, ''];
  return [0, capabilitiesById.get(key)?.name ?? key];
}

/**
 * @param systems Landscape nodes (src/db/landscape.ts's `listSystemsForLandscape`).
 * @param supportsEdges `supports` relationships from a system to a capability (`listSupportsEdgesForSystems`) — used only for lane assignment, never rendered as edges themselves (§6.1: landscape edges are `uses`/`flows_to` only).
 * @param capabilitiesById The capabilities named by `supportsEdges`' targets, for lane labels.
 */
export function computeLandscapeLayout(systems: readonly ElementsHeadRow[], supportsEdges: readonly RelationshipsHeadRow[], capabilitiesById: Map<UUID, ElementsHeadRow>): LandscapeLayout {
  const supportsBySystem = new Map<UUID, UUID[]>();
  for (const edge of supportsEdges) {
    const list = supportsBySystem.get(edge.from_element_id) ?? [];
    list.push(edge.to_element_id);
    supportsBySystem.set(edge.from_element_id, list);
  }

  const byLane = new Map<string, ElementsHeadRow[]>();
  for (const system of systems) {
    const key = laneKeyFor(system, supportsBySystem, capabilitiesById);
    const list = byLane.get(key) ?? [];
    list.push(system);
    byLane.set(key, list);
  }

  const laneKeys = [...byLane.keys()].sort((a, b) => {
    const [ra, na] = laneSortKey(a, capabilitiesById);
    const [rb, nb] = laneSortKey(b, capabilitiesById);
    return ra - rb || na.localeCompare(nb) || a.localeCompare(b);
  });

  const nodes: LandscapeNodePosition[] = [];
  const lanes: LandscapeLane[] = [];
  let y = PADDING;
  let maxWidth = 0;

  for (const key of laneKeys) {
    const members = [...(byLane.get(key) ?? [])].sort(byNameThenId);
    const label = key === EXTERNAL_LANE_KEY ? 'External' : key === UNASSIGNED_LANE_KEY ? 'Unassigned' : (capabilitiesById.get(key)?.name ?? 'Unassigned');
    const laneHeight = LANE_LABEL_HEIGHT + NODE_HEIGHT + LANE_GUTTER_Y;
    lanes.push({ key, label, y, height: laneHeight });

    members.forEach((system, index) => {
      const x = PADDING + index * (NODE_WIDTH + NODE_GUTTER_X);
      nodes.push({ elementId: system.element_id, x, y: y + LANE_LABEL_HEIGHT });
      maxWidth = Math.max(maxWidth, x + NODE_WIDTH + PADDING);
    });
    if (members.length === 0) maxWidth = Math.max(maxWidth, PADDING * 2);

    y += laneHeight;
  }

  return { nodes, lanes, width: maxWidth, height: y + PADDING };
}
