import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import type { ValueStreamRow } from './useValueStreams';
import type { ValueStreamTone } from './valueStreamRollup';

export interface StageMatrixColumn {
  stageId: UUID;
  stageName: string;
  streamId: UUID;
  streamName: string;
}

export interface StageMatrixRow {
  capability: ElementsHeadRow;
  tone: ValueStreamTone;
  /** Stage ids this capability delivers. */
  stageIds: ReadonlySet<UUID>;
}

export interface StageMatrix {
  columns: StageMatrixColumn[];
  rows: StageMatrixRow[];
  /** Stages that no capability delivers — a gap, listed so each can be opened and fixed. */
  undeliveredStages: StageMatrixColumn[];
}

/**
 * BIZBOK's central cross-map: capabilities down the side, value stream stages
 * across the top, a mark wherever a capability delivers a stage. Built from the
 * same rows the stream page already loads (nothing new is stored), active
 * streams only, in the order the page shows them.
 */
export function buildStageMatrix(rows: readonly ValueStreamRow[], tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData>): StageMatrix {
  const columns: StageMatrixColumn[] = [];
  const byCapability = new Map<UUID, Set<UUID>>();
  const undeliveredStages: StageMatrixColumn[] = [];
  for (const row of rows) {
    if (row.inactive) continue;
    for (const stage of row.stages) {
      const column = { stageId: stage.stage.element_id, stageName: stage.stage.name, streamId: row.stream.element_id, streamName: row.stream.name };
      columns.push(column);
      if (stage.enablingCapabilityIds.length === 0) undeliveredStages.push(column);
      for (const capabilityId of stage.enablingCapabilityIds) {
        const set = byCapability.get(capabilityId) ?? new Set<UUID>();
        set.add(stage.stage.element_id);
        byCapability.set(capabilityId, set);
      }
    }
  }
  const matrixRows: StageMatrixRow[] = [];
  for (const [capabilityId, stageIds] of byCapability) {
    const tile = tilesByCapabilityId.get(capabilityId);
    if (!tile) continue;
    matrixRows.push({ capability: tile.capability, tone: tile.tone, stageIds });
  }
  matrixRows.sort((a, b) => a.capability.name.localeCompare(b.capability.name));
  return { columns, rows: matrixRows, undeliveredStages };
}
