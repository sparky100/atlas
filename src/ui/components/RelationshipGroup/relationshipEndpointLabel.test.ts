import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { endpointDisplayName } from './relationshipEndpointLabel';

function el(overrides: Partial<ElementsHeadRow>): ElementsHeadRow {
  return { element_id: 'e1', element_type: 'system', name: 'Element', parent_id: null, attributes: {}, exists_delta_id: 'd1', ...overrides };
}

describe('endpointDisplayName', () => {
  it('prefixes a module with its own parent platform’s name', () => {
    const platform = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'platform' } });
    const module = el({ element_id: 'pm-1', element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    const endpoints = new Map([['sap-1', platform]]);
    expect(endpointDisplayName(module, endpoints)).toBe('SAP · PM');
  });

  it('leaves a top-level system’s own name bare', () => {
    const system = el({ name: 'CRM' });
    expect(endpointDisplayName(system, new Map())).toBe('CRM');
  });

  it('leaves a module’s own name bare when its parent isn’t in the endpoints map', () => {
    const module = el({ element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    expect(endpointDisplayName(module, new Map())).toBe('PM');
  });

  it('leaves a module’s own name bare when its parent isn’t itself a platform', () => {
    const notAPlatform = el({ element_id: 'sap-1', name: 'SAP', attributes: { kind: 'application' } });
    const module = el({ element_type: 'container', name: 'PM', parent_id: 'sap-1' });
    const endpoints = new Map([['sap-1', notAPlatform]]);
    expect(endpointDisplayName(module, endpoints)).toBe('PM');
  });

  it('leaves a parentless module’s own name bare (shouldn’t happen in practice, never throws)', () => {
    const module = el({ element_type: 'container', name: 'PM', parent_id: null });
    expect(endpointDisplayName(module, new Map())).toBe('PM');
  });
});
