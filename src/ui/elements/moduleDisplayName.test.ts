import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { moduleDisplayName } from './moduleDisplayName';

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
