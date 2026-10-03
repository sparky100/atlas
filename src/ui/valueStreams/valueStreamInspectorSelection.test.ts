import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import { valueStreamInspectorEnablingCapabilities, valueStreamInspectorParentStream } from './valueStreamInspectorSelection';
import type { ValueStreamStageRollup } from './valueStreamRollup';

function element(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'value_stream', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function tile(id: string, name: string): CapabilityTileData {
  return { capability: capability(id, name), supportingSystems: [], exposedSystems: [], tone: 'ok', supportedCapabilityCount: 0, totalCapabilityCount: 0, isOwned: false, fitForPurpose: null, weakFitCapabilities: [], adequateFitCount: 0, weakFitAllReplacementPlanned: false, importance: null };
}

function stageRollup(stageId: string, enablingCapabilityIds: readonly string[]): ValueStreamStageRollup {
  return { stage: element(stageId, 'Apply', 'vs-1'), tone: 'ok', enablingCapabilityIds, fitForPurpose: null };
}

describe('valueStreamInspectorEnablingCapabilities', () => {
  it('resolves every enabling capability id to its own tile, name-sorted', () => {
    const tilesByCapabilityId = new Map([
      ['cap-b', tile('cap-b', 'Billing')],
      ['cap-a', tile('cap-a', 'Applications')],
    ]);
    const result = valueStreamInspectorEnablingCapabilities(stageRollup('st-1', ['cap-b', 'cap-a']), tilesByCapabilityId);
    expect(result.map((r) => r.tile.capability.name)).toEqual(['Applications', 'Billing']);
  });

  it('silently skips an enabling id with no tile', () => {
    const result = valueStreamInspectorEnablingCapabilities(stageRollup('st-1', ['cap-missing']), new Map());
    expect(result).toEqual([]);
  });

  it('returns an empty list for a stage nothing enables', () => {
    expect(valueStreamInspectorEnablingCapabilities(stageRollup('st-1', []), new Map())).toEqual([]);
  });
});

describe('valueStreamInspectorParentStream', () => {
  it('resolves a stage\'s own parent stream', () => {
    const stream = element('vs-1', 'Getting Connected');
    const stage = element('st-1', 'Apply', 'vs-1');
    const valueStreamsById = new Map([
      ['vs-1', stream],
      ['st-1', stage],
    ]);
    expect(valueStreamInspectorParentStream(stage, valueStreamsById)).toBe(stream);
  });

  it('returns null when the parent is missing (shouldn\'t happen for a live stage)', () => {
    const stage = element('st-1', 'Apply', 'vs-missing');
    expect(valueStreamInspectorParentStream(stage, new Map())).toBeNull();
  });
});
