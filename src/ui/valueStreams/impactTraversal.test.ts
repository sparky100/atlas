import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { valueStreamsReachedFrom } from './impactTraversal';

function element(elementId: string, elementType: ElementsHeadRow['element_type'], name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: elementId, element_type: elementType, name, parent_id: parentId, attributes: {}, exists_delta_id: `create-${elementId}` };
}

function enables(relationshipId: string, fromElementId: string, toElementId: string): RelationshipsHeadRow {
  return { relationship_id: relationshipId, relationship_type: 'enables', from_element_id: fromElementId, to_element_id: toElementId, attributes: {}, exists_delta_id: `create-${relationshipId}` };
}

describe('valueStreamsReachedFrom', () => {
  it('is empty when no reached capability enables anything', () => {
    const elementsById = new Map([['cap-1', element('cap-1', 'capability', 'Housing')]]);
    expect(valueStreamsReachedFrom(['cap-1'], elementsById, [])).toEqual([]);
  });

  it('groups a single reached stage under its parent stream', () => {
    const cap = element('cap-1', 'capability', 'Connections');
    const stream = element('vs-1', 'value_stream', 'Getting Connected');
    const stage = element('st-1', 'value_stream', 'Apply', 'vs-1');
    const elementsById = new Map([cap, stream, stage].map((el) => [el.element_id, el]));

    const result = valueStreamsReachedFrom(['cap-1'], elementsById, [enables('rel-1', 'cap-1', 'st-1')]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ stream: { element_id: 'vs-1' } });
    expect(result[0]?.stages).toMatchObject([{ stage: { element_id: 'st-1' }, viaCapabilities: [{ element_id: 'cap-1' }] }]);
  });

  it('a stage enabled by two reached capabilities lists both, sorted by name', () => {
    const capB = element('cap-b', 'capability', 'Billing');
    const capA = element('cap-a', 'capability', 'Accounts');
    const stream = element('vs-1', 'value_stream', 'Getting Connected');
    const stage = element('st-1', 'value_stream', 'Apply', 'vs-1');
    const elementsById = new Map([capA, capB, stream, stage].map((el) => [el.element_id, el]));

    const result = valueStreamsReachedFrom(
      ['cap-a', 'cap-b'],
      elementsById,
      [enables('rel-1', 'cap-b', 'st-1'), enables('rel-2', 'cap-a', 'st-1')],
    );

    expect(result[0]?.stages[0]?.viaCapabilities.map((c) => c.element_id)).toEqual(['cap-a', 'cap-b']);
  });

  it('two stages of the same stream, reached by different capabilities, both appear under one stream row, in display order', () => {
    const cap1 = element('cap-1', 'capability', 'Connections');
    const cap2 = element('cap-2', 'capability', 'Metering');
    const stream = element('vs-1', 'value_stream', 'Getting Connected');
    const stageQuote = element('st-quote', 'value_stream', 'Quote', 'vs-1');
    stageQuote.attributes = { order: 20 };
    const stageApply = element('st-apply', 'value_stream', 'Apply', 'vs-1');
    stageApply.attributes = { order: 10 };
    const elementsById = new Map([cap1, cap2, stream, stageQuote, stageApply].map((el) => [el.element_id, el]));

    const result = valueStreamsReachedFrom(
      ['cap-1', 'cap-2'],
      elementsById,
      [enables('rel-1', 'cap-2', 'st-quote'), enables('rel-2', 'cap-1', 'st-apply')],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.stages.map((s) => s.stage.element_id)).toEqual(['st-apply', 'st-quote']);
  });

  it('reaches stages across two different streams, each its own row, sorted by stream name', () => {
    const cap = element('cap-1', 'capability', 'Connections');
    const streamZ = element('vs-z', 'value_stream', 'Zonal Ops');
    const stageZ = element('st-z', 'value_stream', 'Dispatch', 'vs-z');
    const streamA = element('vs-a', 'value_stream', 'Apply for Service');
    const stageA = element('st-a', 'value_stream', 'Submit', 'vs-a');
    const elementsById = new Map([cap, streamZ, stageZ, streamA, stageA].map((el) => [el.element_id, el]));

    const result = valueStreamsReachedFrom(['cap-1'], elementsById, [enables('rel-1', 'cap-1', 'st-z'), enables('rel-2', 'cap-1', 'st-a')]);

    expect(result.map((r) => r.stream.element_id)).toEqual(['vs-a', 'vs-z']);
  });

  it('ignores an enables edge whose source capability was not reached', () => {
    const cap = element('cap-unreached', 'capability', 'Unreached');
    const stream = element('vs-1', 'value_stream', 'Getting Connected');
    const stage = element('st-1', 'value_stream', 'Apply', 'vs-1');
    const elementsById = new Map([cap, stream, stage].map((el) => [el.element_id, el]));

    expect(valueStreamsReachedFrom(['cap-other'], elementsById, [enables('rel-1', 'cap-unreached', 'st-1')])).toEqual([]);
  });

  it('ignores an enables edge whose target has no parent (a stream, not a stage — shouldn\'t happen given C22, but this reads whatever it\'s handed)', () => {
    const cap = element('cap-1', 'capability', 'Connections');
    const stream = element('vs-1', 'value_stream', 'Getting Connected');
    const elementsById = new Map([cap, stream].map((el) => [el.element_id, el]));

    expect(valueStreamsReachedFrom(['cap-1'], elementsById, [enables('rel-1', 'cap-1', 'vs-1')])).toEqual([]);
  });

  it('skips a stage or stream since retracted (absent from elementsById)', () => {
    const cap = element('cap-1', 'capability', 'Connections');
    const elementsById = new Map([[cap.element_id, cap]]);

    expect(valueStreamsReachedFrom(['cap-1'], elementsById, [enables('rel-1', 'cap-1', 'st-gone')])).toEqual([]);
  });
});
