/**
 * The shared "one more hop" ADR-023/F6 adds on top of the existing
 * system → `supports` → capability traversal (`src/db/changeSummary.ts`'s
 * own `affectedCapabilities`): capability → `enables` → stage → parent
 * stream. Callers resolve which capabilities are already "reached" their
 * own way — `changeSummary.ts`'s own touched-system traversal, a
 * decision's own linked capability ids, or (Step 4) a capability element
 * page's own id, alone — this function is only the hop from there onward,
 * so it's the one place that hop is ever written, never re-derived per
 * caller.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { compareBySiblingOrder } from '../elements/siblingOrder';

export interface AffectedValueStreamStage {
  stage: ElementsHeadRow;
  /** Which of the input capability ids enable this specific stage — a stage is commonly enabled by more than one, and only the ones actually reached are listed here. */
  viaCapabilities: ElementsHeadRow[];
}

export interface AffectedValueStream {
  stream: ElementsHeadRow;
  /** In display order (`compareBySiblingOrder`) — the same "stages left to right" reading the Value streams page itself uses. */
  stages: AffectedValueStreamStage[];
}

/**
 * @param capabilityIds Capabilities already reached by whatever traversal the caller did before calling this — never re-derived here.
 * @param elementsById Every element in scope, keyed by id — needs to resolve a stage's own parent stream and every element's current name.
 * @param enablesEdges Every live `enables` edge in scope, already filtered to `relationship_type === 'enables'` (the same "caller filters by type first" convention every other edge-scoped function in this codebase uses).
 */
export function valueStreamsReachedFrom(capabilityIds: readonly UUID[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>, enablesEdges: readonly RelationshipsHeadRow[]): AffectedValueStream[] {
  const capabilityIdSet = new Set(capabilityIds);
  // streamId -> stageId -> the set of reached capability ids enabling it.
  const stagesByStreamId = new Map<UUID, Map<UUID, Set<UUID>>>();

  for (const edge of enablesEdges) {
    if (!capabilityIdSet.has(edge.from_element_id)) continue;
    const stage = elementsById.get(edge.to_element_id);
    // A retracted stage, or (shouldn't happen given C22, but this reads
    // whatever the caller handed it, not a re-validated head) not actually
    // a stage — either way, nothing to report this edge into.
    if (!stage?.parent_id) continue;
    const stageMap = stagesByStreamId.get(stage.parent_id) ?? new Map<UUID, Set<UUID>>();
    const capabilityIdsForStage = stageMap.get(stage.element_id) ?? new Set<UUID>();
    capabilityIdsForStage.add(edge.from_element_id);
    stageMap.set(stage.element_id, capabilityIdsForStage);
    stagesByStreamId.set(stage.parent_id, stageMap);
  }

  const result: AffectedValueStream[] = [];
  for (const [streamId, stageMap] of stagesByStreamId) {
    const stream = elementsById.get(streamId);
    if (!stream) continue; // retracted since.
    const stages: AffectedValueStreamStage[] = [];
    for (const [stageId, viaCapabilityIds] of stageMap) {
      const stage = elementsById.get(stageId);
      if (!stage) continue;
      const viaCapabilities = [...viaCapabilityIds]
        .map((id) => elementsById.get(id))
        .filter((element): element is ElementsHeadRow => element !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name));
      stages.push({ stage, viaCapabilities });
    }
    stages.sort((a, b) => compareBySiblingOrder(a.stage, b.stage));
    result.push({ stream, stages });
  }
  result.sort((a, b) => a.stream.name.localeCompare(b.stream.name));
  return result;
}
