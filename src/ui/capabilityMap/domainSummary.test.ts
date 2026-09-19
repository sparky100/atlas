import { describe, expect, it } from 'vitest';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { domainCoverageSegments, domainCoverageSummary, domainSystemsCountText } from './domainSummary';

function supportsEdge(toElementId: string, fromElementId: string): RelationshipsHeadRow {
  return {
    relationship_id: `${fromElementId}-${toElementId}`,
    relationship_type: 'supports',
    from_element_id: fromElementId,
    to_element_id: toElementId,
    attributes: {},
  } as unknown as RelationshipsHeadRow;
}

describe('domainCoverageSegments', () => {
  it('marks a capability with at least one supporting system as covered', () => {
    const segments = domainCoverageSegments(['cap-a', 'cap-b'], [supportsEdge('cap-a', 'sys-1')]);
    expect(segments).toEqual([
      { capabilityId: 'cap-a', hasSupport: true },
      { capabilityId: 'cap-b', hasSupport: false },
    ]);
  });

  it('preserves the input order and produces one segment per id, including duplicates', () => {
    const segments = domainCoverageSegments(['cap-a', 'cap-a'], []);
    expect(segments.map((s) => s.capabilityId)).toEqual(['cap-a', 'cap-a']);
  });

  it('is empty for an empty subtree', () => {
    expect(domainCoverageSegments([], [])).toEqual([]);
  });
});

describe('domainCoverageSummary', () => {
  it('pluralizes "capabilities have" for a count other than one', () => {
    expect(domainCoverageSummary(5, 7)).toBe('5 of 7 capabilities have a supporting system');
    expect(domainCoverageSummary(0, 3)).toBe('0 of 3 capabilities have a supporting system');
  });

  it('uses singular "capability has" when the total is exactly one', () => {
    expect(domainCoverageSummary(1, 1)).toBe('1 of 1 capability has a supporting system');
    expect(domainCoverageSummary(0, 1)).toBe('0 of 1 capability has a supporting system');
  });
});

describe('domainSystemsCountText', () => {
  it('reads "no systems" at zero', () => {
    expect(domainSystemsCountText(0)).toBe('no systems');
  });

  it('uses singular "system" for exactly one', () => {
    expect(domainSystemsCountText(1)).toBe('1 system');
  });

  it('pluralizes "systems" for any other count', () => {
    expect(domainSystemsCountText(11)).toBe('11 systems');
  });
});
