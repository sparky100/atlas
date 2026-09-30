import { describe, expect, it } from 'vitest';
import type { Json, ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { highCostOverlapByCapability, isCheapCostBand, isHighCostBand, overlapCapabilityIdsFor, topLevelSystemIdOf } from './portfolioOverlap';

function system(id: string, annualRunCost?: string): ElementsHeadRow {
  const attrs: Record<string, Json> = {};
  if (annualRunCost !== undefined) attrs.annualRunCost = annualRunCost;
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

function container(id: string, parentId: string, annualRunCost?: string): ElementsHeadRow {
  const attrs: Record<string, Json> = {};
  if (annualRunCost !== undefined) attrs.annualRunCost = annualRunCost;
  return { element_id: id, element_type: 'container', name: id, parent_id: parentId, attributes: attrs, exists_delta_id: `d-${id}` };
}

function supports(fromId: string, toId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${fromId}-${toId}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: {}, exists_delta_id: `d-r-${fromId}` };
}

describe('isHighCostBand', () => {
  it('is true at or above the 250k_1m threshold', () => {
    expect(isHighCostBand('250k_1m')).toBe(true);
    expect(isHighCostBand('1m_5m')).toBe(true);
    expect(isHighCostBand('over_5m')).toBe(true);
  });

  it('is false below the threshold', () => {
    expect(isHighCostBand('50k_250k')).toBe(false);
    expect(isHighCostBand('under_50k')).toBe(false);
    expect(isHighCostBand('none_included')).toBe(false);
  });

  it('is never true for an unset (not entered) cost', () => {
    expect(isHighCostBand(null)).toBe(false);
  });
});

describe('isCheapCostBand', () => {
  it('is true only for none_included or under_50k', () => {
    expect(isCheapCostBand('none_included')).toBe(true);
    expect(isCheapCostBand('under_50k')).toBe(true);
    expect(isCheapCostBand('50k_250k')).toBe(false);
  });

  it('is never true for an unset (not entered) cost', () => {
    expect(isCheapCostBand(null)).toBe(false);
  });
});

describe('topLevelSystemIdOf', () => {
  it("returns a system's own id", () => {
    expect(topLevelSystemIdOf(system('sys-1'))).toBe('sys-1');
  });

  it("returns a module container's parent platform id", () => {
    expect(topLevelSystemIdOf(container('mod-1', 'platform-1'))).toBe('platform-1');
  });

  it('throws for a container with no parent (an impossible state, per V2)', () => {
    const orphan = container('mod-1', 'platform-1');
    orphan.parent_id = null;
    expect(() => topLevelSystemIdOf(orphan)).toThrow();
  });
});

describe('highCostOverlapByCapability', () => {
  it('flags a capability with two distinct high-cost top-level supporters', () => {
    const sys1 = system('sys-1', '1m_5m');
    const sys2 = system('sys-2', '250k_1m');
    const elementsById = new Map([
      ['sys-1', sys1],
      ['sys-2', sys2],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    const overlaps = highCostOverlapByCapability(edges, elementsById);
    expect(overlaps.get('cap-1')).toEqual(new Set(['sys-1', 'sys-2']));
  });

  it('does not flag a capability with only one high-cost supporter, even alongside a cheap one', () => {
    const sys1 = system('sys-1', '1m_5m');
    const sys2 = system('sys-2', 'under_50k');
    const elementsById = new Map([
      ['sys-1', sys1],
      ['sys-2', sys2],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    expect(highCostOverlapByCapability(edges, elementsById).has('cap-1')).toBe(false);
  });

  it('counts a platform and its own module as one supporter, not two', () => {
    const platform = system('platform-1', '1m_5m');
    const module1 = container('mod-1', 'platform-1', '1m_5m');
    const otherSystem = system('sys-2', '250k_1m');
    const elementsById = new Map([
      ['platform-1', platform],
      ['mod-1', module1],
      ['sys-2', otherSystem],
    ]);
    // platform-1 and its own module both support cap-1: one top-level supporter, not two.
    const edges = [supports('platform-1', 'cap-1'), supports('mod-1', 'cap-1'), supports('sys-2', 'cap-1')];
    const overlaps = highCostOverlapByCapability(edges, elementsById);
    expect(overlaps.get('cap-1')).toEqual(new Set(['platform-1', 'sys-2']));
  });

  it("uses the highest cost band among a top-level system's own contributing elements for that capability", () => {
    const platform = system('platform-1', 'under_50k');
    const module1 = container('mod-1', 'platform-1', '1m_5m');
    const otherSystem = system('sys-2', '250k_1m');
    const elementsById = new Map([
      ['platform-1', platform],
      ['mod-1', module1],
      ['sys-2', otherSystem],
    ]);
    const edges = [supports('platform-1', 'cap-1'), supports('mod-1', 'cap-1'), supports('sys-2', 'cap-1')];
    // platform-1's own edge is cheap, but its module's edge is high-cost — the top-level system still counts as high-cost.
    const overlaps = highCostOverlapByCapability(edges, elementsById);
    expect(overlaps.get('cap-1')).toEqual(new Set(['platform-1', 'sys-2']));
  });

  it('ignores an unset (not entered) cost rather than treating it as low', () => {
    const sys1 = system('sys-1', '1m_5m');
    const sys2 = system('sys-2'); // not entered
    const elementsById = new Map([
      ['sys-1', sys1],
      ['sys-2', sys2],
    ]);
    const edges = [supports('sys-1', 'cap-1'), supports('sys-2', 'cap-1')];
    expect(highCostOverlapByCapability(edges, elementsById).has('cap-1')).toBe(false);
  });
});

describe('overlapCapabilityIdsFor', () => {
  it('lists every capability where the given top-level system is a flagged high-cost supporter', () => {
    const overlapsByCapability = new Map([
      ['cap-1', new Set(['sys-1', 'sys-2'])],
      ['cap-2', new Set(['sys-3', 'sys-4'])],
    ]);
    expect(overlapCapabilityIdsFor('sys-1', overlapsByCapability)).toEqual(['cap-1']);
  });

  it('returns an empty list for a system with no overlap anywhere', () => {
    const overlapsByCapability = new Map([['cap-1', new Set(['sys-1', 'sys-2'])]]);
    expect(overlapCapabilityIdsFor('sys-9', overlapsByCapability)).toEqual([]);
  });
});
