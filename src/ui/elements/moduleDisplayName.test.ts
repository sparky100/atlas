import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { containerParentIds, moduleDisplayName, moduleDisplayNameFromMap } from './moduleDisplayName';

function el(overrides: Partial<ElementsHeadRow>): ElementsHeadRow {
  return { element_id: 'e1', element_type: 'system', name: 'Element', parent_id: null, attributes: {}, exists_delta_id: 'd1', ...overrides };
}

describe('moduleDisplayName', () => {
  it('prefixes a module with its own parent platform’s name', () => {
    const platform = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'platform' } });
    const module = el({ element_id: 'pm-1', element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    expect(moduleDisplayName(module, platform)).toBe('SAP · PM');
  });

  it('leaves a top-level system’s own name bare, even when a parent is given', () => {
    const system = el({ name: 'CRM' });
    const platform = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'platform' } });
    expect(moduleDisplayName(system, platform)).toBe('CRM');
  });

  it('leaves a module’s own name bare when no parent is given', () => {
    const module = el({ element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    expect(moduleDisplayName(module, null)).toBe('PM');
  });

  it('leaves a module’s own name bare when its parent isn’t itself a platform', () => {
    const notAPlatform = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'application' } });
    const module = el({ element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    expect(moduleDisplayName(module, notAPlatform)).toBe('PM');
  });
});

describe('containerParentIds', () => {
  it('collects the parent id of every container, deduplicated', () => {
    const sap = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'platform' } });
    const pm = el({ element_id: 'pm-1', element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    const fi = el({ element_id: 'fi-1', element_type: 'container', name: 'FI', parent_id: 'sap-1' });
    expect(containerParentIds([sap, pm, fi])).toEqual(['sap-1']);
  });

  it('ignores a non-container element, and a container with no parent', () => {
    const system = el({ name: 'CRM' });
    const topLevelContainer = el({ element_id: 'x', element_type: 'container', name: 'X', parent_id: null });
    expect(containerParentIds([system, topLevelContainer])).toEqual([]);
  });
});

describe('moduleDisplayNameFromMap', () => {
  it('resolves the parent from the map by parent_id, then delegates to moduleDisplayName', () => {
    const sap = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'platform' } });
    const module = el({ element_id: 'pm-1', element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    const byId = new Map([['sap-1', sap]]);
    expect(moduleDisplayNameFromMap(module, byId)).toBe('SAP · PM');
  });

  it('falls back to the bare name when the parent isn’t in the map', () => {
    const module = el({ element_id: 'pm-1', element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    expect(moduleDisplayNameFromMap(module, new Map())).toBe('PM');
  });
});
