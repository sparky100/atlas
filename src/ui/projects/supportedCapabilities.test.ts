import { describe, expect, it } from 'vitest';
import { capabilityIdsSupportedBy, scopeSystemLikeIds, supportedCapabilitiesNotice } from './supportedCapabilities';

const edge = (type: string, from: string, to: string) => ({ relationship_type: type as 'supports', from_element_id: from, to_element_id: to });

describe('capabilityIdsSupportedBy', () => {
  it('returns the capabilities the system supports, once each, in order', () => {
    const edges = [edge('supports', 's1', 'c2'), edge('supports', 's1', 'c1'), edge('supports', 's1', 'c2'), edge('supports', 's2', 'c3')];
    expect(capabilityIdsSupportedBy(edges, 's1')).toEqual(['c2', 'c1']);
  });

  it('ignores other link types and links where the system is the target', () => {
    const edges = [edge('uses', 's1', 'c1'), edge('supports', 'c9', 's1'), edge('flows_to', 's1', 's2')];
    expect(capabilityIdsSupportedBy(edges, 's1')).toEqual([]);
  });
});

describe('supportedCapabilitiesNotice', () => {
  it('says which capabilities were added', () => {
    expect(supportedCapabilitiesNotice('DUoS Billing Engine', ['Bill customers'])).toBe('Added the capability DUoS Billing Engine supports: Bill customers. Remove any this project does not serve.');
    expect(supportedCapabilitiesNotice('X', ['A', 'B'])).toContain('Added the capabilities X supports: A, B.');
  });

  it('says no link is recorded, without saying there is no business use', () => {
    const text = supportedCapabilitiesNotice('Quote Tool', []);
    expect(text).toContain('no capability link recorded');
    expect(text).toContain('No business use has been ruled in or out');
  });
});

describe('scopeSystemLikeIds', () => {
  it('picks out systems and modules, so a module in scope has its capabilities filled in too (M2)', () => {
    const scope = [
      { elementId: 's1', name: 'Billing', elementType: 'system' as const },
      { elementId: 'm1', name: 'Billing · Invoicing', elementType: 'container' as const },
      { elementId: 'c1', name: 'Bill customers', elementType: 'capability' as const },
      { elementId: 'x', name: 'Unknown' },
    ];
    expect(scopeSystemLikeIds(scope)).toEqual(['s1', 'm1']);
  });
});
