import { describe, expect, it } from 'vitest';
import { fakeElement, fakeSupportsEdge } from '../portfolio/portfolioTestFixtures';
import { buildSupportMatrix, cellKey, matrixLinkCount } from './supportMatrixModel';

const cap = (id: string, parent: string | null) => ({ ...fakeElement(id), element_type: 'capability' as const, name: id, parent_id: parent });
const sys = (id: string) => ({ ...fakeElement(id), name: id });
const edge = (from: string, to: string, attributes: Record<string, string> = {}) => ({ ...fakeSupportsEdge(from, to), relationship_id: `r-${from}-${to}`, attributes });

const caps = new Map([cap('A', null), cap('A1', 'A'), cap('A1x', 'A1'), cap('B', null)].map((c) => [c.element_id, c]));

describe('buildSupportMatrix', () => {
  it('collapsed: every link beneath a level 1 counts in its column', () => {
    const m = buildSupportMatrix({ systems: [sys('s')], supportsEdges: [edge('s', 'A'), edge('s', 'A1'), edge('s', 'A1x'), edge('s', 'B')], capabilitiesById: caps, expandedL1Ids: new Set() });
    expect(m.columns.map((c) => c.key)).toEqual(['l1:A', 'l1:B']);
    expect(m.cells.get(cellKey('s', 'l1:A'))?.edges).toHaveLength(3);
    expect(m.cells.get(cellKey('s', 'l1:B'))?.edges).toHaveLength(1);
  });

  it('expanded: direct links and each child get their own column, level 3 under its level 2', () => {
    const m = buildSupportMatrix({ systems: [sys('s')], supportsEdges: [edge('s', 'A'), edge('s', 'A1x')], capabilitiesById: caps, expandedL1Ids: new Set(['A']) });
    expect(m.columns.map((c) => c.key)).toEqual(['l1:A', 'l2:A1', 'l1:B']);
    expect(m.columns[0]?.label).toBe('A: directly');
    expect(m.cells.get(cellKey('s', 'l1:A'))?.edges).toHaveLength(1);
    expect(m.cells.get(cellKey('s', 'l2:A1'))?.edges).toHaveLength(1);
  });

  it('shows the worst rated fit and the primary mark', () => {
    const m = buildSupportMatrix({ systems: [sys('s')], supportsEdges: [edge('s', 'A', { fitForPurpose: 'good', role: 'primary' }), edge('s', 'A1', { fitForPurpose: 'poor' })], capabilitiesById: caps, expandedL1Ids: new Set() });
    expect(m.cells.get(cellKey('s', 'l1:A'))).toMatchObject({ fit: 'poor', primary: true });
  });

  it('nests a platform\'s modules under it and leaves out links from unlisted systems', () => {
    const platform = sys('p');
    const mod = { ...fakeElement('m', 'container'), name: 'm', parent_id: 'p' };
    const m = buildSupportMatrix({ systems: [mod, sys('z'), platform], supportsEdges: [edge('m', 'B'), edge('gone', 'B')], capabilitiesById: caps, expandedL1Ids: new Set() });
    expect(m.rows.map((r) => [r.system.element_id, r.depth])).toEqual([['p', 0], ['m', 1], ['z', 0]]);
    expect(matrixLinkCount(m)).toBe(1);
  });

  it('counts a link to an unknown capability as unplaced, never dropped', () => {
    const m = buildSupportMatrix({ systems: [sys('s')], supportsEdges: [edge('s', 'nowhere'), edge('s', 'B')], capabilitiesById: caps, expandedL1Ids: new Set() });
    expect(m.unplacedLinks).toBe(1);
    expect(matrixLinkCount(m)).toBe(2);
  });

  it('property: links placed plus unplaced equals links from listed systems, in any input order and expansion', () => {
    const systems = ['s1', 's2', 's3'].map(sys);
    const targets = ['A', 'A1', 'A1x', 'B', 'nowhere'];
    const edges = systems.flatMap((s, i) => targets.filter((_, j) => (i + j) % 2 === 0).map((t) => edge(s.element_id, t)));
    for (const expanded of [new Set<string>(), new Set(['A']), new Set(['A', 'B'])]) {
      for (const order of [edges, [...edges].reverse()]) {
        expect(matrixLinkCount(buildSupportMatrix({ systems, supportsEdges: order, capabilitiesById: caps, expandedL1Ids: expanded }))).toBe(edges.length);
      }
    }
  });
});
