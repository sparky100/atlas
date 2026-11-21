import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import type { ElementRow, RelationshipRow } from '../../engine/deltas';
import type { ElementVersionDiff, RelationshipVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { impactedLaneKeys, optionImpactSystemIds, scopeLaneKeys } from './decisionOptionImpact';

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function system(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function supports(fromId: string, toId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${fromId}-${toId}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: {}, exists_delta_id: `d-r-${fromId}-${toId}` };
}

function elementRow(name: string, attributes: Record<string, Json> = {}): ElementRow {
  return { elementType: 'system', name, parentId: null, attributes, existsDeltaId: 'd1' };
}

function relationshipRow(from: string, to: string): RelationshipRow {
  return { relationshipType: 'supports', fromElementId: from, toElementId: to, attributes: {}, existsDeltaId: 'd2' };
}

function elementDiff(elementId: string, state: ElementVersionDiff['state']): ElementVersionDiff {
  return { elementId, state, asIs: state === 'added' ? null : elementRow('x'), toBe: state === 'removed' ? null : elementRow('x'), changedAttributes: [] };
}

function relationshipDiff(relationshipId: string, state: RelationshipVersionDiff['state'], from: string, to: string): RelationshipVersionDiff {
  const row = relationshipRow(from, to);
  return { relationshipId, state, asIs: state === 'added' ? null : row, toBe: state === 'removed' ? null : row, changedAttributes: [] };
}

const capA = capability('cap-a', 'Alpha');
const capB = capability('cap-b', 'Beta');
const sysA = system('sys-a', 'Sys A');
const sysB = system('sys-b', 'Sys B');
const supportsEdges = [supports('sys-a', 'cap-a'), supports('sys-b', 'cap-b')];
const l1 = new Map([['cap-a', capA], ['cap-b', capB]]);

describe('impactedLaneKeys', () => {
  it('is empty when nothing in the diff changed', () => {
    const diff: VersionDiff = { elements: [elementDiff('sys-a', 'unchanged'), elementDiff('sys-b', 'unchanged')], relationships: [] };
    expect(impactedLaneKeys(diff, [sysA, sysB], supportsEdges, l1)).toEqual(new Set());
  });

  it('includes a lane whose primary system element itself changed', () => {
    const diff: VersionDiff = { elements: [elementDiff('sys-a', 'changed'), elementDiff('sys-b', 'unchanged')], relationships: [] };
    expect(impactedLaneKeys(diff, [sysA, sysB], supportsEdges, l1)).toEqual(new Set(['cap-a']));
  });

  it('includes a lane whose system\'s own relationship changed, even with the element row itself unchanged (e.g. a re-pointed supports edge)', () => {
    const diff: VersionDiff = { elements: [elementDiff('sys-a', 'unchanged'), elementDiff('sys-b', 'unchanged')], relationships: [relationshipDiff('r-sys-a-cap-a', 'added', 'sys-a', 'cap-a')] };
    expect(impactedLaneKeys(diff, [sysA, sysB], supportsEdges, l1)).toEqual(new Set(['cap-a']));
  });

  it('does not mark a lane impacted just because a capability element itself changed, with no related system change', () => {
    const diff: VersionDiff = { elements: [elementDiff('sys-a', 'unchanged'), elementDiff('sys-b', 'unchanged'), elementDiff('cap-a', 'changed')], relationships: [] };
    expect(impactedLaneKeys(diff, [sysA, sysB], supportsEdges, l1)).toEqual(new Set());
  });
});

describe('scopeLaneKeys', () => {
  it('uses the lane of a system the decision names', () => {
    expect(scopeLaneKeys(new Set(['sys-a']), [sysA, sysB], supportsEdges, l1)).toEqual(new Set(['cap-a']));
  });

  it('uses the lane of the systems that support a capability the decision names', () => {
    expect(scopeLaneKeys(new Set(['cap-b']), [sysA, sysB], supportsEdges, l1)).toEqual(new Set(['cap-b']));
  });

  it('is empty when the decision names nothing in the landscape', () => {
    expect(scopeLaneKeys(new Set(), [sysA, sysB], supportsEdges, l1)).toEqual(new Set());
  });
});

describe('optionImpactSystemIds', () => {
  const ids = new Set(['sys-a', 'sys-b']);
  it('does not turn a capability with many supporters into many touched systems', () => {
    expect(optionImpactSystemIds({ elements: [elementDiff('sys-a', 'changed'), elementDiff('sys-b', 'unchanged')], relationships: [] }, ids)).toEqual(new Set());
    const renamed = { ...elementDiff('sys-a', 'changed'), changedAttributes: ['name'], toBe: elementRow('Renamed') };
    expect(optionImpactSystemIds({ elements: [renamed, elementDiff('sys-b', 'unchanged')], relationships: [] }, ids)).toEqual(new Set(['sys-a']));
  });
  it('includes both system ends of a changed connection and removed systems', () => {
    const diff: VersionDiff = { elements: [elementDiff('sys-a', 'removed')], relationships: [relationshipDiff('edge', 'removed', 'sys-a', 'sys-b')] };
    expect(optionImpactSystemIds(diff, ids)).toEqual(new Set(['sys-a', 'sys-b']));
  });
});
