import { describe, expect, it } from 'vitest';
import type { Json } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { capabilityMapInspectorSupportingSystems, capabilityMapLevelOf } from './capabilityMapInspectorSelection';
import { computeCapabilityMapTree } from './layout';

function capability(id: string, name: string, parentId: string | null = null, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes, exists_delta_id: `d-${id}` };
}

function system(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function relationship(id: string, from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'supports', from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('capabilityMapLevelOf', () => {
  it('finds an L1, L2, and L3 capability at their own correct level', () => {
    const l1 = capability('c1', 'Finance');
    const l2 = capability('c2', 'Billing', 'c1');
    const l3 = capability('c3', 'Invoicing', 'c2');
    const tree = computeCapabilityMapTree([l1, l2, l3]);
    expect(capabilityMapLevelOf('c1', tree)).toBe(1);
    expect(capabilityMapLevelOf('c2', tree)).toBe(2);
    expect(capabilityMapLevelOf('c3', tree)).toBe(3);
  });

  it('returns null for an id not present in the tree at all', () => {
    const tree = computeCapabilityMapTree([capability('c1', 'Finance')]);
    expect(capabilityMapLevelOf('missing', tree)).toBeNull();
  });
});

describe('capabilityMapInspectorSupportingSystems', () => {
  it('lists only systems with a direct supports edge into this exact capability, never a descendant’s', () => {
    const systemsById = new Map([
      ['s1', system('s1', 'CRM')],
      ['s2', system('s2', 'Billing App')],
    ]);
    const supportsEdges = [relationship('r1', 's1', 'c1'), relationship('r2', 's2', 'c2')];
    const result = capabilityMapInspectorSupportingSystems('c1', supportsEdges, systemsById);
    expect(result).toEqual([{ systemId: 's1', systemName: 'CRM' }]);
  });

  it('falls back to the raw id when the system row is missing from the map', () => {
    const result = capabilityMapInspectorSupportingSystems('c1', [relationship('r1', 's1', 'c1')], new Map());
    expect(result).toEqual([{ systemId: 's1', systemName: 's1' }]);
  });
});
