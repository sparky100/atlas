import { describe, expect, it } from 'vitest';
import { fakeElement } from '../portfolio/portfolioTestFixtures';
import { ACTORS_AREA_KEY, buildConnectionsMatrix, connectionCellKey, connectionLinkCount } from './connectionsMatrixModel';

const sys = (id: string) => ({ ...fakeElement(id), name: id });
const group = (key: string, ...ids: string[]) => ({ key, label: key.toUpperCase(), members: ids.map((id) => ({ system: sys(id), usesCount: 0, usedByCount: 0 })) });
const link = (from: string, to: string, type: 'flows_to' | 'uses' = 'flows_to', attributes: Record<string, string> = {}) => ({
  relationship_id: `r-${type}-${from}-${to}`,
  relationship_type: type,
  from_element_id: from,
  to_element_id: to,
  attributes,
  exists_delta_id: `d-${from}-${to}`,
});

const groups = [group('a', 's1', 's2'), group('b', 's3'), group('empty')];

describe('buildConnectionsMatrix', () => {
  it('counts links between areas, in both directions separately, and skips empty areas', () => {
    const m = buildConnectionsMatrix(groups, [], [link('s1', 's3'), link('s2', 's3'), link('s3', 's1')], 'flows_to');
    expect(m.areas.map((a) => a.key)).toEqual(['a', 'b']);
    expect(m.cells.get(connectionCellKey('a', 'b'))).toHaveLength(2);
    expect(m.cells.get(connectionCellKey('b', 'a'))).toHaveLength(1);
  });

  it('puts links inside one area on the diagonal', () => {
    const m = buildConnectionsMatrix(groups, [], [link('s1', 's2')], 'flows_to');
    expect(m.cells.get(connectionCellKey('a', 'a'))).toHaveLength(1);
  });

  it('keeps data flows and dependencies apart', () => {
    const edges = [link('s1', 's3', 'flows_to'), link('s1', 's3', 'uses')];
    expect(buildConnectionsMatrix(groups, [], edges, 'flows_to').cells.get(connectionCellKey('a', 'b'))).toHaveLength(1);
    expect(buildConnectionsMatrix(groups, [], edges, 'uses').cells.get(connectionCellKey('a', 'b'))).toHaveLength(1);
  });

  it('counts a link through an integration platform once, between its two real ends', () => {
    const m = buildConnectionsMatrix([...groups, group('p', 'platform')], [], [link('s1', 's3', 'flows_to', { via: 'platform' })], 'flows_to');
    expect([...m.cells.values()].flat()).toHaveLength(1);
    expect(m.cells.get(connectionCellKey('a', 'b'))).toHaveLength(1);
  });

  it('puts internal actors in their own area and counts a link with an unplaced end as unplaced', () => {
    const m = buildConnectionsMatrix(groups, ['act'], [link('act', 's1', 'uses'), link('ghost', 's1', 'uses')], 'uses');
    expect(m.cells.get(connectionCellKey(ACTORS_AREA_KEY, 'a'))).toHaveLength(1);
    expect(m.unplaced).toBe(1);
  });

  it('property: placed plus unplaced equals every link of the kind, in any input order', () => {
    const ids = ['s1', 's2', 's3', 'act', 'ghost'];
    const edges = ids.flatMap((a) => ids.filter((b) => b !== a && (a.length + b.length) % 2 === 0).map((b) => link(a, b)));
    for (const order of [edges, [...edges].reverse()]) {
      expect(connectionLinkCount(buildConnectionsMatrix(groups, ['act'], order, 'flows_to'))).toBe(edges.length);
    }
  });
});
