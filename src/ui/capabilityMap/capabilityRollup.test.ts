import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { computeCapabilityRollup } from './capabilityRollup';

function capability(id: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: id, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

let nextOrdinal = 0;
function supports(fromId: string, toId: string, fitForPurpose?: string): RelationshipsHeadRow {
  nextOrdinal += 1;
  const attrs = fitForPurpose === undefined ? {} : { fitForPurpose };
  return { relationship_id: `r-${String(nextOrdinal)}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: attrs, exists_delta_id: `d-r-${String(nextOrdinal)}` };
}

describe('computeCapabilityRollup', () => {
  const l1 = capability('l1', null);
  const l2a = capability('l2a', 'l1');
  const l2b = capability('l2b', 'l1');
  const l3 = capability('l3', 'l2a');
  const allCapabilities = [l1, l2a, l2b, l3];
  const capabilitiesById = new Map(allCapabilities.map((c) => [c.element_id, c]));

  it('dedupes a system that supports two descendants of the same level-1 parent to one', () => {
    const supportsEdges = [supports('sys-1', 'l2a'), supports('sys-1', 'l2b')];
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, supportsEdges, new Set());
    expect(rollup.supportingSystemIds).toEqual(['sys-1']);
  });

  it('rolls up a supporter of an L3 leaf into the L1 count', () => {
    const supportsEdges = [supports('sys-1', 'l3')];
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, supportsEdges, new Set());
    expect(rollup.supportingSystemIds).toEqual(['sys-1']);
  });

  it('never includes a supporter of a sibling subtree', () => {
    const other = capability('other', null);
    const supportsEdges = [supports('sys-1', 'other')];
    const rollup = computeCapabilityRollup(l1, [...allCapabilities, other], new Map([...capabilitiesById, ['other', other]]), supportsEdges, new Set());
    expect(rollup.supportingSystemIds).toEqual([]);
  });

  it('computes the supported/total capability fraction across the subtree, L1 included', () => {
    const supportsEdges = [supports('sys-1', 'l1'), supports('sys-2', 'l2a')];
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, supportsEdges, new Set());
    // subtree = {l1, l2a, l2b, l3} — l1 and l2a have a direct supporter, l2b/l3 don't.
    expect(rollup.totalCapabilityCount).toBe(4);
    expect(rollup.supportedCapabilityCount).toBe(2);
  });

  it('isOwned is true when the L1 capability itself is self-owned', () => {
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, [], new Set(['l1']));
    expect(rollup.isOwned).toBe(true);
  });

  it('isOwned is false when neither the L1 capability nor an ancestor is self-owned (it has none)', () => {
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, [], new Set(['l2a']));
    expect(rollup.isOwned).toBe(false);
  });

  it('a system counted twice via two edges into the same descendant still counts once', () => {
    const supportsEdges = [supports('sys-1', 'l2a'), supports('sys-1', 'l3')];
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, supportsEdges, new Set());
    expect(rollup.supportingSystemIds).toEqual(['sys-1']);
  });

  it('fitForPurpose: a poor rating anywhere in the subtree makes the rollup poor', () => {
    const supportsEdges = [supports('sys-1', 'l2a', 'good'), supports('sys-2', 'l3', 'poor')];
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, supportsEdges, new Set());
    expect(rollup.fitForPurpose).toBe('poor');
  });

  it('fitForPurpose: null when nothing in the subtree is rated', () => {
    const supportsEdges = [supports('sys-1', 'l2a')];
    const rollup = computeCapabilityRollup(l1, allCapabilities, capabilitiesById, supportsEdges, new Set());
    expect(rollup.fitForPurpose).toBeNull();
  });
});
