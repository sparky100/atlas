import { describe, expect, it } from 'vitest';
import { capabilityLevel } from './capabilityDepth';
import type { ElementsHeadRow } from '../../contracts/rows';

function capability(id: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: id, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('capabilityLevel', () => {
  it('is 1 for a root capability (no parent)', () => {
    expect(capabilityLevel(null, null)).toBe(1);
  });

  it('is 2 for a capability whose parent is itself a root', () => {
    expect(capabilityLevel(capability('p', null), null)).toBe(2);
  });

  it('is 3 for a capability whose grandparent is a root', () => {
    expect(capabilityLevel(capability('p', 'gp'), capability('gp', null))).toBe(3);
  });

  it('is null when the parent has a parent but the grandparent was not supplied', () => {
    expect(capabilityLevel(capability('p', 'gp'), null)).toBeNull();
  });

  it('is null when nesting goes deeper than 3 levels', () => {
    expect(capabilityLevel(capability('p', 'gp'), capability('gp', 'ggp'))).toBeNull();
  });
});
