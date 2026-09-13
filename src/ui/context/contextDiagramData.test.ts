import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { buildPlatformModulesById } from './contextDiagramData';

function system(id: string, name: string, kind?: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false, ...(kind !== undefined ? { kind } : {}) }, exists_delta_id: `d-${id}` };
}

function container(id: string, name: string, parentId: string, lifecycleStatus?: string): ElementsHeadRow {
  return { element_id: id, element_type: 'container', name, parent_id: parentId, attributes: { isExternal: false, ...(lifecycleStatus !== undefined ? { lifecycleStatus } : {}) }, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function supports(id: string, from: string, to: string, role?: 'primary' | 'secondary'): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'supports', from_element_id: from, to_element_id: to, attributes: role ? { role } : {}, exists_delta_id: `d-${id}` };
}

describe('buildPlatformModulesById', () => {
  it("V1 fix: carries each module's own name and lifecycleStatus, not just its capability", () => {
    const sap = system('sap', 'SAP', 'platform');
    const bw = container('bw', 'SAP BW', 'sap', 'retiring');
    const fi = container('fi', 'SAP FI', 'sap');
    const finance = capability('cap-finance', 'Finance');
    const capabilitiesById = new Map([['cap-finance', finance]]);
    const edges = [supports('r1', 'fi', 'cap-finance', 'primary')];

    const result = buildPlatformModulesById([sap], [bw, fi], edges, capabilitiesById);
    const modules = result.get('sap');
    expect(modules).toBeDefined();

    const bwModule = modules?.find((m) => m.elementId === 'bw');
    expect(bwModule).toMatchObject({ name: 'SAP BW', capabilityName: null, lifecycleStatus: 'retiring' });

    const fiModule = modules?.find((m) => m.elementId === 'fi');
    expect(fiModule).toMatchObject({ name: 'SAP FI', capabilityName: 'Finance', lifecycleStatus: null });
  });

  it('lifecycleStatus is null, never a malformed non-string value, for a module that never recorded one', () => {
    const sap = system('sap', 'SAP', 'platform');
    const fi = container('fi', 'SAP FI', 'sap');
    const result = buildPlatformModulesById([sap], [fi], [], new Map());
    expect(result.get('sap')?.[0]?.lifecycleStatus).toBeNull();
  });

  it('a non-platform candidate contributes no modules at all', () => {
    const app = system('app', 'Ordinary App');
    const child = container('c1', 'Child', 'app');
    const result = buildPlatformModulesById([app], [child], [], new Map());
    expect(result.size).toBe(0);
  });
});
