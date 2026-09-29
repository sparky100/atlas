import { describe, expect, it } from 'vitest';
import { lifecycleStatusOf, criticalityOf } from './elementBrowse';
import type { ElementsHeadRow, Json } from '../contracts/rows';

function element(id: string, type: ElementsHeadRow['element_type'], attributes: Record<string, Json> = {}, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parentId, attributes, exists_delta_id: `delta-${id}` };
}

describe('lifecycleStatusOf / criticalityOf', () => {
  it("a system's own value is read directly, parent ignored", () => {
    const system = element('sap', 'system', { lifecycleStatus: 'active', criticality: 'high' });
    expect(lifecycleStatusOf(system)).toBe('active');
    expect(criticalityOf(system)).toBe('high');
  });

  it('a system with no value set reads null', () => {
    const system = element('sap', 'system');
    expect(lifecycleStatusOf(system)).toBeNull();
    expect(criticalityOf(system)).toBeNull();
  });

  it("a module (container) with no override reads its platform's value, same as effectiveModuleAttributes", () => {
    const platform = element('sap', 'system', { lifecycleStatus: 'active', criticality: 'high' });
    const module = element('fi', 'container', {}, 'sap');
    expect(lifecycleStatusOf(module, platform)).toBe('active');
    expect(criticalityOf(module, platform)).toBe('high');
  });

  it("a module's own override wins over the platform's value", () => {
    const platform = element('sap', 'system', { lifecycleStatus: 'active', criticality: 'high' });
    const module = element('fi', 'container', { lifecycleStatus: 'retiring', criticality: 'critical' }, 'sap');
    expect(lifecycleStatusOf(module, platform)).toBe('retiring');
    expect(criticalityOf(module, platform)).toBe('critical');
  });

  it('a container reads null when no parent is passed at all (existing call sites without one loaded)', () => {
    const module = element('fi', 'container', {}, 'sap');
    expect(lifecycleStatusOf(module)).toBeNull();
    expect(criticalityOf(module)).toBeNull();
  });

  it('a container reads null when the parent itself has no value to inherit', () => {
    const platform = element('sap', 'system');
    const module = element('fi', 'container', {}, 'sap');
    expect(lifecycleStatusOf(module, platform)).toBeNull();
    expect(criticalityOf(module, platform)).toBeNull();
  });

  it('an ordinary (non-module) container — no lifecycle/criticality ever set, no platform passed — reads null, unchanged from before this resolution existed', () => {
    const container = element('web-tier', 'container');
    expect(lifecycleStatusOf(container)).toBeNull();
    expect(criticalityOf(container)).toBeNull();
  });

  it('every other element type (capability, actor, value_stream) reads null regardless of a passed parent', () => {
    const parent = element('sap', 'system', { lifecycleStatus: 'active', criticality: 'high' });
    for (const type of ['capability', 'actor', 'value_stream'] as const) {
      const e = element('x', type, { lifecycleStatus: 'active', criticality: 'high' }, 'sap');
      expect(lifecycleStatusOf(e, parent)).toBeNull();
      expect(criticalityOf(e, parent)).toBeNull();
    }
  });
});
