import { describe, expect, it } from 'vitest';
import { REPORT_SPEC_VERSION, type ReportSpec } from '../../contracts/reportSpec';
import { canEditDashboard, kpiBaseline, nextTilePosition, reportsOfferableTo, specForTile, suggestedTileKind, swapTilePositions, tileColumnSpan, tileKindsFor } from './dashboardTiles';

const base: ReportSpec = { specVersion: REPORT_SPEC_VERSION, source: 'elements', filters: [{ field: 'type', operator: 'eq', value: 'system' }], columns: ['name'], sort: [{ field: 'name', direction: 'asc' }], presentation: { kind: 'table' } };
const grouped: ReportSpec = { ...base, groupBy: 'lifecycle', presentation: { kind: 'barByField' } };
const split: ReportSpec = { ...grouped, splitBy: 'owner' };

describe('tileKindsFor and suggestedTileKind', () => {
  it('offers only what the report can show', () => {
    expect(tileKindsFor(base)).toEqual(['kpi', 'table']);
    expect(tileKindsFor(grouped)).toEqual(['kpi', 'bar', 'donut', 'table']);
    expect(tileKindsFor(split)).toEqual(['kpi', 'bar', 'donut', 'stackedBar', 'table']);
  });
  it('suggests the natural kind', () => {
    expect(suggestedTileKind(base)).toBe('table');
    expect(suggestedTileKind({ ...base, presentation: { kind: 'count' } })).toBe('kpi');
    expect(suggestedTileKind(grouped)).toBe('bar');
    expect(suggestedTileKind({ ...grouped, presentation: { kind: 'donut' } })).toBe('donut');
    expect(suggestedTileKind(split)).toBe('stackedBar');
  });
});

describe('specForTile', () => {
  it('keeps the report asking the same question, whatever the tile shows', () => {
    for (const kind of tileKindsFor(split)) {
      const tile = specForTile(split, kind, null);
      expect(tile.filters).toEqual(split.filters);
      expect(tile.source).toBe(split.source);
      expect(tile.sort).toEqual(split.sort);
    }
  });
  it('drops splitBy except for a stacked bar', () => {
    expect(specForTile(split, 'bar', null).splitBy).toBeUndefined();
    expect(specForTile(split, 'stackedBar', null).splitBy).toBe('owner');
  });
  it('a table tile takes its row limit, with a default', () => {
    expect(specForTile(base, 'table', 8).presentation).toEqual({ kind: 'table', limit: 8 });
    expect(specForTile(base, 'table', null).presentation).toEqual({ kind: 'table', limit: 5 });
  });
  it('a kind the report cannot show becomes a big number', () => {
    expect(specForTile(base, 'donut', null).presentation).toEqual({ kind: 'count' });
    expect(specForTile(grouped, 'stackedBar', null).presentation).toEqual({ kind: 'count' });
  });
  it('does not change the spec it is given', () => {
    const before = JSON.stringify(split);
    specForTile(split, 'bar', null);
    expect(JSON.stringify(split)).toBe(before);
  });
});

describe('swapTilePositions', () => {
  const tiles = [{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 4 }];
  function apply(ops: { id: string; position: number }[]): Record<string, number> {
    const state: Record<string, number> = Object.fromEntries(tiles.map((t) => [t.id, t.position]));
    for (const op of ops) {
      // No two tiles may ever share a position between updates.
      state[op.id] = op.position;
      expect(new Set(Object.values(state)).size).toBe(Object.values(state).length);
    }
    return state;
  }
  it('swaps with the next tile without ever sharing a position', () => {
    expect(apply(swapTilePositions(tiles, 'b', 'later'))).toEqual({ a: 0, b: 4, c: 1 });
  });
  it('swaps with the previous tile', () => {
    expect(apply(swapTilePositions(tiles, 'b', 'earlier'))).toEqual({ a: 1, b: 0, c: 4 });
  });
  it('does nothing at either end or for an unknown tile', () => {
    expect(swapTilePositions(tiles, 'a', 'earlier')).toEqual([]);
    expect(swapTilePositions(tiles, 'c', 'later')).toEqual([]);
    expect(swapTilePositions(tiles, 'zz', 'later')).toEqual([]);
  });
});

describe('small helpers', () => {
  it('nextTilePosition is one past the last', () => {
    expect(nextTilePosition([])).toBe(0);
    expect(nextTilePosition([{ position: 0 }, { position: 4 }])).toBe(5);
  });
  it('a shared dashboard is offered only shared reports', () => {
    const reports = [{ visibility: 'private' as const }, { visibility: 'organisation' as const }];
    expect(reportsOfferableTo(reports, 'organisation')).toEqual([{ visibility: 'organisation' }]);
    expect(reportsOfferableTo(reports, 'private')).toHaveLength(2);
  });
  it('column spans', () => {
    expect([tileColumnSpan('one'), tileColumnSpan('two'), tileColumnSpan('full')]).toEqual([1, 2, 3]);
  });
});

describe('canEditDashboard', () => {
  const d = (created_by: string, visibility: 'private' | 'organisation') => ({ created_by, visibility });
  it('the creator can; others only for a shared one and only as owner or architect', () => {
    expect(canEditDashboard(d('u1', 'private'), 'u1', 'contributor')).toBe(true);
    expect(canEditDashboard(d('u1', 'private'), 'u2', 'owner')).toBe(false);
    expect(canEditDashboard(d('u1', 'organisation'), 'u2', 'architect')).toBe(true);
    expect(canEditDashboard(d('u1', 'organisation'), 'u2', 'contributor')).toBe(false);
    expect(canEditDashboard(d('u1', 'organisation'), null, 'owner')).toBe(false);
  });
});

describe('kpiBaseline', () => {
  it('measures a big number against the same kind of thing, before the other filters', () => {
    const rows = [
      { id: '1', elementType: 'system', owner: null },
      { id: '2', elementType: 'system', owner: 'IT' },
      { id: '3', elementType: 'container', owner: null },
    ];
    const spec = { specVersion: 1 as const, source: 'portfolio' as const, filters: [{ field: 'elementType', operator: 'neq' as const, value: 'container' }, { field: 'owner', operator: 'isEmpty' as const, value: null }], columns: ['id'], sort: [], presentation: { kind: 'count' as const } };
    expect(kpiBaseline(spec, rows)).toEqual({ total: 2, noun: 'applications' });
    expect(kpiBaseline({ ...spec, filters: [] }, rows)).toEqual({ total: 3, noun: 'portfolio items' });
    expect(kpiBaseline({ ...spec, source: 'elements', filters: [{ field: 'type', operator: 'eq', value: 'system' }] }, [{ id: 'a', type: 'system' }, { id: 'b', type: 'capability' }])).toEqual({ total: 1, noun: 'systems' });
  });
});
