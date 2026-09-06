import { describe, expect, it } from 'vitest';
import { compareCapabilities, computeCapabilityMapTree } from './layout';
import type { ElementsHeadRow } from '../../contracts/rows';

function capability(id: string, name: string, parentId: string | null, code?: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: code !== undefined ? { code, level: 1 } : { level: 1 }, exists_delta_id: `d-${id}` };
}

describe('computeCapabilityMapTree', () => {
  it('places root capabilities as L1 columns, ordered deterministically', () => {
    const tree = computeCapabilityMapTree([capability('b', 'Beta', null), capability('a', 'Alpha', null)]);
    expect(tree.l1.map((c) => c.capability.element_id)).toEqual(['a', 'b']);
    expect(tree.orphans).toEqual([]);
  });

  it('nests a capability under its parent as an L2 card, and that card is empty of L3 tiles when it has no children', () => {
    const tree = computeCapabilityMapTree([capability('root', 'Root', null), capability('child', 'Child', 'root')]);
    expect(tree.l1).toHaveLength(1);
    const [root] = tree.l1;
    if (!root) throw new Error('expected one L1 column');
    expect(root.l2).toEqual([{ capability: capability('child', 'Child', 'root'), l3: [] }]);
  });

  it('nests a grandchild as an L3 tile inside its L2 parent', () => {
    const tree = computeCapabilityMapTree([capability('root', 'Root', null), capability('mid', 'Mid', 'root'), capability('leaf', 'Leaf', 'mid')]);
    const l2 = tree.l1[0]?.l2[0];
    if (!l2) throw new Error('expected one L2 card');
    expect(l2.capability.element_id).toBe('mid');
    expect(l2.l3.map((c) => c.element_id)).toEqual(['leaf']);
  });

  it('treats a fourth level of nesting as an orphan rather than silently dropping or misplacing it', () => {
    const tree = computeCapabilityMapTree([
      capability('root', 'Root', null),
      capability('l2', 'L2', 'root'),
      capability('l3', 'L3', 'l2'),
      capability('l4', 'L4', 'l3'),
    ]);
    expect(tree.orphans.map((c) => c.element_id)).toEqual(['l4']);
  });

  it('treats a capability whose parent_id points at nothing in this head as an orphan', () => {
    const tree = computeCapabilityMapTree([capability('a', 'Alpha', 'missing-parent')]);
    expect(tree.orphans.map((c) => c.element_id)).toEqual(['a']);
  });

  it('treats a parent cycle as orphans rather than looping forever', () => {
    const tree = computeCapabilityMapTree([capability('a', 'A', 'b'), capability('b', 'B', 'a')]);
    expect(tree.l1).toEqual([]);
    expect(tree.orphans.map((c) => c.element_id).sort()).toEqual(['a', 'b']);
  });

  it('is deterministic under input reordering', () => {
    const caps = [capability('root', 'Root', null), capability('b', 'Beta', 'root'), capability('a', 'Alpha', 'root')];
    const treeA = computeCapabilityMapTree(caps);
    const treeB = computeCapabilityMapTree([...caps].reverse());
    expect(treeB).toEqual(treeA);
  });
});

describe('compareCapabilities', () => {
  it('sorts by numeric-aware code when both sides have one, not lexicographically', () => {
    const c2 = capability('c2', 'Two', null, '2.2');
    const c10 = capability('c10', 'Ten', null, '2.10');
    expect(compareCapabilities(c2, c10)).toBeLessThan(0);
    expect([c10, c2].sort(compareCapabilities).map((c) => c.element_id)).toEqual(['c2', 'c10']);
  });

  it('falls back to name when either side has no code', () => {
    const withCode = capability('a', 'Zeta', null, '1.1');
    const withoutCode = capability('b', 'Alpha', null);
    expect([withCode, withoutCode].sort(compareCapabilities).map((c) => c.element_id)).toEqual(['b', 'a']);
  });
});
