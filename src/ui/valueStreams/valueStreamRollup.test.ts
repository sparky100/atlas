import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { stagesOf, streamsOf } from './valueStreamRollup';

function element(elementId: string, name: string, parentId: string | null, order?: number): ElementsHeadRow {
  return { element_id: elementId, element_type: 'value_stream', name, parent_id: parentId, attributes: order === undefined ? {} : { order }, exists_delta_id: `create-${elementId}` };
}

describe('streamsOf / stagesOf', () => {
  it('streamsOf returns only parentless elements, in display order', () => {
    const streamB = element('vs-b', 'Beta Stream', null, 20);
    const streamA = element('vs-a', 'Alpha Stream', null, 10);
    const stage = element('st-1', 'A Stage', 'vs-a', 1);
    const all = [streamB, stage, streamA];

    expect(streamsOf(all).map((s) => s.element_id)).toEqual(['vs-a', 'vs-b']);
  });

  it('stagesOf returns only the given stream\'s own children, in display order — a sibling stream\'s stages are excluded', () => {
    const streamA = element('vs-a', 'Alpha', null);
    const streamB = element('vs-b', 'Beta', null);
    const stageA2 = element('st-a2', 'Quote', 'vs-a', 20);
    const stageA1 = element('st-a1', 'Apply', 'vs-a', 10);
    const stageB1 = element('st-b1', 'Other stream\'s stage', 'vs-b', 5);
    const all = [streamA, streamB, stageA2, stageB1, stageA1];

    expect(stagesOf(streamA, all).map((s) => s.element_id)).toEqual(['st-a1', 'st-a2']);
  });

  it('a stream with no stages returns an empty list', () => {
    const streamA = element('vs-a', 'Alpha', null);
    expect(stagesOf(streamA, [streamA])).toEqual([]);
  });
});
