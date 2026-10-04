import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { OpenDecisionElementLink } from '../../db/decisions';
import type { ElementProjectScope } from '../../db/healthFindings';
import type { CapabilityTileData } from '../../db/modelHome';
import type { DecisionRow } from '../../db/types';

/**
 * Overview's weak tiles say what's already addressing them (UI-principles
 * §3, 2026-10-04): an open project whose declared scope (ADR-024
 * `project_links`) names the capability, or an open decision that names it
 * (`decision_links`). A tile with something in hand drops its own "Start a
 * decision / Start a project" actions — the work is already started.
 *
 * What counts as naming a tile: its level-1 capability, any capability
 * beneath it, or one of the systems causing its exposure
 * (`exposedSystems` — a project to replace a retiring system addresses the
 * capability that system exposes). Not every supporting system: a project
 * scoped to a shared platform would otherwise mark every tile that
 * platform supports as in hand.
 */

export interface InHandItem {
  id: UUID;
  title: string;
}

export interface TileInHand {
  projects: InHandItem[];
  /** Open decisions naming the tile that aren't already part of one of `projects` — a decision inside a listed project is shown by its project. */
  decisions: InHandItem[];
}

const NOTHING_IN_HAND: TileInHand = { projects: [], decisions: [] };

export function isNothingInHand(inHand: TileInHand): boolean {
  return inHand.projects.length === 0 && inHand.decisions.length === 0;
}

/** Each capability's level-1 ancestor (itself, for a level-1 one), walking `parent_id`. A cycle or a missing parent stops the walk at the last capability reached. */
function levelOneAncestors(capabilities: readonly ElementsHeadRow[]): Map<UUID, UUID> {
  const byId = new Map(capabilities.map((c) => [c.element_id, c]));
  const result = new Map<UUID, UUID>();
  for (const capability of capabilities) {
    let current = capability;
    const seen = new Set<UUID>([current.element_id]);
    while (current.parent_id !== null) {
      const parent = byId.get(current.parent_id);
      if (!parent || seen.has(parent.element_id)) break;
      seen.add(parent.element_id);
      current = parent;
    }
    result.set(capability.element_id, current.element_id);
  }
  return result;
}

export function computeTileInHand(
  tiles: readonly CapabilityTileData[],
  allCapabilities: readonly ElementsHeadRow[],
  projectScope: readonly ElementProjectScope[],
  decisionLinks: readonly OpenDecisionElementLink[],
  /** Every decision on the model — only open ones are ever matched (`decisionLinks` is already open-only). */
  decisions: readonly DecisionRow[],
): Map<UUID, TileInHand> {
  const l1Of = levelOneAncestors(allCapabilities);
  // Which tile(s) each element names: a capability names its own level-1
  // tile; an exposed system names every tile it exposes.
  const tilesByElement = new Map<UUID, Set<UUID>>();
  const addTile = (elementId: UUID, tileId: UUID) => {
    const set = tilesByElement.get(elementId) ?? new Set<UUID>();
    set.add(tileId);
    tilesByElement.set(elementId, set);
  };
  const tileIds = new Set(tiles.map((t) => t.capability.element_id));
  for (const [capabilityId, l1] of l1Of) if (tileIds.has(l1)) addTile(capabilityId, l1);
  for (const tile of tiles) for (const system of tile.exposedSystems) addTile(system.element_id, tile.capability.element_id);

  const decisionsById = new Map(decisions.map((d) => [d.id, d]));
  const projectsByTile = new Map<UUID, Map<UUID, InHandItem>>();
  const decisionsByTile = new Map<UUID, Map<UUID, InHandItem>>();
  const add = (index: Map<UUID, Map<UUID, InHandItem>>, tileId: UUID, item: InHandItem) => {
    const items = index.get(tileId) ?? new Map<UUID, InHandItem>();
    items.set(item.id, item);
    index.set(tileId, items);
  };

  for (const scope of projectScope) {
    for (const tileId of tilesByElement.get(scope.elementId) ?? []) add(projectsByTile, tileId, { id: scope.projectId, title: scope.projectTitle });
  }
  for (const link of decisionLinks) {
    const decision = decisionsById.get(link.decisionId);
    if (decision?.status !== 'proposed') continue;
    for (const tileId of tilesByElement.get(link.elementId) ?? []) add(decisionsByTile, tileId, { id: decision.id, title: decision.title });
  }

  const byTitle = (a: InHandItem, b: InHandItem) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const result = new Map<UUID, TileInHand>();
  for (const tileId of tileIds) {
    const projects = [...(projectsByTile.get(tileId)?.values() ?? [])].sort(byTitle);
    const projectIds = new Set(projects.map((p) => p.id));
    const tileDecisions = [...(decisionsByTile.get(tileId)?.values() ?? [])].filter((d) => {
      const projectId = decisionsById.get(d.id)?.project_id ?? null;
      return projectId === null || !projectIds.has(projectId);
    });
    result.set(tileId, projects.length === 0 && tileDecisions.length === 0 ? NOTHING_IN_HAND : { projects, decisions: tileDecisions.sort(byTitle) });
  }
  return result;
}
