import { describe, expect, it } from 'vitest';
import { systemsAndModulesFor } from './roadmapModules';
import type { ElementsHeadRow, Json } from '../../contracts/rows';

function element(id: string, type: ElementsHeadRow['element_type'], attributes: Record<string, Json> = {}, parentId: string | null = null, name = id): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: parentId, attributes, exists_delta_id: `delta-${id}` };
}

describe('systemsAndModulesFor', () => {
  it('includes a module (Container) alongside ordinary systems — the bug this fixes', () => {
    const platform = element('sap', 'system', { kind: 'platform', lifecycleStatus: 'active' });
    const module = element('bw', 'container', { plannedEnd: '2027-12-31', lifecycleStatus: 'retiring' }, 'sap', 'BW');
    const capability = element('cap', 'capability');
    const result = systemsAndModulesFor([platform, module, capability]);
    expect(result.map((e) => e.element_id).sort()).toEqual(['bw', 'sap']);
  });

  it("a module's own lifecycle dates carry straight through — they're the module's own, never inherited", () => {
    const platform = element('sap', 'system', { kind: 'platform' });
    const module = element('bw', 'container', { plannedEnd: '2027-12-31' }, 'sap', 'BW');
    const [, resolved] = systemsAndModulesFor([platform, module]);
    expect(resolved?.attributes).toMatchObject({ plannedEnd: '2027-12-31' });
  });

  it("a module with no criticality override reads the platform's own value", () => {
    const platform = element('sap', 'system', { kind: 'platform', criticality: 'high' });
    const module = element('bw', 'container', {}, 'sap', 'BW');
    const [, resolved] = systemsAndModulesFor([platform, module]);
    expect(resolved?.attributes).toMatchObject({ criticality: 'high' });
  });

  it('relabels a platform module "{platform} · {module}" — same convention as the landscape canvas', () => {
    const platform = element('sap', 'system', { kind: 'platform' }, null, 'SAP');
    const module = element('bw', 'container', {}, 'sap', 'BW');
    const [, resolved] = systemsAndModulesFor([platform, module]);
    expect(resolved?.name).toBe('SAP · BW');
  });

  it('leaves an ordinary system (not a module) untouched', () => {
    const system = element('crm', 'system', { lifecycleStatus: 'active' }, null, 'CRM');
    const [resolved] = systemsAndModulesFor([system]);
    expect(resolved).toBe(system);
  });

  it('a container with no live parent in scope keeps its own attributes and name, unresolved', () => {
    const module = element('orphan', 'container', { criticality: 'low' }, 'missing-parent', 'Orphan');
    const [resolved] = systemsAndModulesFor([module]);
    expect(resolved).toBe(module);
  });
});
