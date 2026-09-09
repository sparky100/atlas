import { describe, expect, it } from 'vitest';
import { compareCapabilities, computeCapabilityMapTree, nextSiblingOrder } from './layout';
import type { ElementsHeadRow } from '../../contracts/rows';

function capability(id: string, name: string, parentId: string | null, code?: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: code !== undefined ? { code, level: 1 } : { level: 1 }, exists_delta_id: `d-${id}` };
}

function orderedCapability(id: string, name: string, order: number): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: { order }, exists_delta_id: `d-${id}` };
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

  it('Sprint U4-1 C1: sorts by attributes.order first, overriding what code order alone would give', () => {
    // Code "1" would normally sort before "2" — order says otherwise.
    const codeFirst = { ...capability('a', 'Alpha', null, '1'), attributes: { code: '1', order: 20 } };
    const codeSecond = { ...capability('b', 'Beta', null, '2'), attributes: { code: '2', order: 10 } };
    expect([codeFirst, codeSecond].sort(compareCapabilities).map((c) => c.element_id)).toEqual(['b', 'a']);
  });

  it('an ordered capability always sorts before an unordered one, regardless of name/code', () => {
    const ordered = orderedCapability('a', 'Zeta', 10);
    const unordered = capability('b', 'Alpha', null);
    expect([unordered, ordered].sort(compareCapabilities).map((c) => c.element_id)).toEqual(['a', 'b']);
  });

  it('two unordered capabilities still fall back to code/name, unaffected by the order comparison', () => {
    const a = capability('a', 'Alpha', null);
    const b = capability('b', 'Beta', null);
    expect([b, a].sort(compareCapabilities).map((c) => c.element_id)).toEqual(['a', 'b']);
  });
});

function withOrder(id: string, name: string, parentId: string | null, order: number): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: { order }, exists_delta_id: `d-${id}` };
}

describe('nextSiblingOrder (Sprint U4-1 C1)', () => {
  it('one more than the highest existing L1 order, for a new top-level capability (parentId: null)', () => {
    const tree = computeCapabilityMapTree([withOrder('a', 'Alpha', null, 10), withOrder('b', 'Beta', null, 20)]);
    expect(nextSiblingOrder(tree, null)).toBe(21);
  });

  it('1 when there are no siblings yet', () => {
    const tree = computeCapabilityMapTree([]);
    expect(nextSiblingOrder(tree, null)).toBe(1);
  });

  it('1 when siblings exist but none of them have an order', () => {
    const tree = computeCapabilityMapTree([capability('a', 'Alpha', null), capability('b', 'Beta', null)]);
    expect(nextSiblingOrder(tree, null)).toBe(1);
  });

  it('scopes to the given parent — an L1 id looks at that L1\'s own L2 children, not any other group', () => {
    const tree = computeCapabilityMapTree([
      withOrder('root-a', 'Root A', null, 10),
      withOrder('root-b', 'Root B', null, 20),
      withOrder('child-a1', 'Child A1', 'root-a', 10),
      withOrder('child-b1', 'Child B1', 'root-b', 100),
    ]);
    expect(nextSiblingOrder(tree, 'root-a')).toBe(11);
    expect(nextSiblingOrder(tree, 'root-b')).toBe(101);
  });

  it('scopes to an L2 id\'s own L3 children', () => {
    const tree = computeCapabilityMapTree([
      withOrder('root', 'Root', null, 10),
      withOrder('mid', 'Mid', 'root', 10),
      withOrder('leaf', 'Leaf', 'mid', 5),
    ]);
    expect(nextSiblingOrder(tree, 'mid')).toBe(6);
  });

  it('an unresolvable parentId (not a real L1/L2 in this tree) has no siblings to consider — always 1', () => {
    const tree = computeCapabilityMapTree([withOrder('a', 'Alpha', null, 10)]);
    expect(nextSiblingOrder(tree, 'does-not-exist')).toBe(1);
  });
});
