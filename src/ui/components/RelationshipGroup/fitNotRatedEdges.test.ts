import { describe, expect, it } from 'vitest';
import type { Json, RelationshipsHeadRow } from '../../../contracts/rows';
import { fitNotRatedRelationshipIds } from './fitNotRatedEdges';

function supports(id: string, fromId: string, capabilityId: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'supports', from_element_id: fromId, to_element_id: capabilityId, attributes, exists_delta_id: `delta-${id}` };
}

describe('fitNotRatedRelationshipIds', () => {
  it('flags a primary supports edge into a capability with no fitForPurpose recorded', () => {
    const rows = [supports('r1', 'sys-1', 'cap-1', { role: 'primary' })];
    expect(fitNotRatedRelationshipIds('inbound', 'capability', 'cap-1', rows)).toEqual(new Set(['r1']));
  });

  it('does not flag a primary supports edge that already carries a fitForPurpose rating', () => {
    const rows = [supports('r1', 'sys-1', 'cap-1', { role: 'primary', fitForPurpose: 'poor' })];
    expect(fitNotRatedRelationshipIds('inbound', 'capability', 'cap-1', rows)).toEqual(new Set());
  });

  it('falls back to flagging an unrated secondary edge when the capability has no primary edge at all', () => {
    const rows = [supports('r1', 'sys-1', 'cap-1', { role: 'secondary' })];
    expect(fitNotRatedRelationshipIds('inbound', 'capability', 'cap-1', rows)).toEqual(new Set(['r1']));
  });

  it('does not flag an unrated secondary edge when the capability also has a primary edge', () => {
    const rows = [supports('r1', 'sys-1', 'cap-1', { role: 'primary', fitForPurpose: 'good' }), supports('r2', 'sys-2', 'cap-1', { role: 'secondary' })];
    expect(fitNotRatedRelationshipIds('inbound', 'capability', 'cap-1', rows)).toEqual(new Set());
  });

  it('never flags anything on the outbound direction (a system\'s own "supports" group)', () => {
    const rows = [supports('r1', 'sys-1', 'cap-1', { role: 'primary' })];
    expect(fitNotRatedRelationshipIds('outbound', 'system', 'sys-1', rows)).toEqual(new Set());
  });

  it('never flags anything for an element type other than capability', () => {
    const rows = [supports('r1', 'sys-1', 'sys-2', { role: 'primary' })];
    expect(fitNotRatedRelationshipIds('inbound', 'system', 'sys-2', rows)).toEqual(new Set());
  });

  it('returns an empty set for an empty rows array', () => {
    expect(fitNotRatedRelationshipIds('inbound', 'capability', 'cap-1', [])).toEqual(new Set());
  });
});
