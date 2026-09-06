import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { computeStructureGroup } from './structureGrouping';

function element(id: string, type: ElementsHeadRow['element_type'], name: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function rel(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('computeStructureGroup', () => {
  it('lists every child, sorted deterministically, regardless of relationships', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const b = element('b', 'container', 'Beta', 'sys');
    const a = element('a', 'container', 'Alpha', 'sys');
    const group = computeStructureGroup(parent, [b, a], [], new Map());
    expect(group.children.map((c) => c.element_id)).toEqual(['a', 'b']);
  });

  it('classifies a relationship between two children as internal, not external', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const a = element('a', 'container', 'A', 'sys');
    const b = element('b', 'container', 'B', 'sys');
    const group = computeStructureGroup(parent, [a, b], [rel('r1', 'uses', 'a', 'b')], new Map());
    expect(group.internalEdges.map((e) => e.relationship_id)).toEqual(['r1']);
    expect(group.externals).toEqual([]);
  });

  it('classifies the far endpoint of a relationship reaching outside the children as external', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const a = element('a', 'container', 'A', 'sys');
    const outside = element('ext', 'container', 'External Container', 'other-sys');
    const group = computeStructureGroup(parent, [a], [rel('r1', 'uses', 'a', 'ext')], new Map([['ext', outside]]));
    expect(group.externals.map((e) => e.element.element_id)).toEqual(['ext']);
    expect(group.internalEdges).toEqual([]);
  });

  it('treats a whole external system reached via container→system uses the same way as an external container', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const a = element('a', 'container', 'A', 'sys');
    const otherSystem = element('other-sys', 'system', 'Other System', null);
    const group = computeStructureGroup(parent, [a], [rel('r1', 'uses', 'a', 'other-sys')], new Map([['other-sys', otherSystem]]));
    expect(group.externals.map((e) => e.element.element_id)).toEqual(['other-sys']);
  });

  it('collects every edge to the same external endpoint under one entry, not one per edge', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const a = element('a', 'container', 'A', 'sys');
    const ext = element('ext', 'container', 'Ext', 'other-sys');
    const group = computeStructureGroup(parent, [a], [rel('r1', 'uses', 'a', 'ext'), rel('r2', 'flows_to', 'ext', 'a')], new Map([['ext', ext]]));
    expect(group.externals).toHaveLength(1);
    expect(group.externals[0]?.edges.map((e) => e.relationship_id).sort()).toEqual(['r1', 'r2']);
  });

  it('drops an external relationship whose far endpoint never resolved', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const a = element('a', 'container', 'A', 'sys');
    const group = computeStructureGroup(parent, [a], [rel('r1', 'uses', 'a', 'missing')], new Map());
    expect(group.externals).toEqual([]);
  });

  it('sorts externals deterministically by name then id', () => {
    const parent = element('sys', 'system', 'Sys', null);
    const a = element('a', 'container', 'A', 'sys');
    const extB = element('extB', 'container', 'Beta', 'x');
    const extA = element('extA', 'container', 'Alpha', 'x');
    const group = computeStructureGroup(parent, [a], [rel('r1', 'uses', 'a', 'extB'), rel('r2', 'uses', 'a', 'extA')], new Map([['extB', extB], ['extA', extA]]));
    expect(group.externals.map((e) => e.element.element_id)).toEqual(['extA', 'extB']);
  });
});
