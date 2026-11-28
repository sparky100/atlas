import { describe, expect, it } from 'vitest';
import { buildCoverage, type CoverageInput, type CoverageProduct } from './catalogueCoverage';

const item = (id: string, code: string, name: string, parentCode: string | null) => ({ id, code, name, parentCode, level: code.split('.').length });
const product = (id: string, published: boolean): CoverageProduct => ({ id, product: `P-${id}`, vendor: 'V', published });

const input = (over: Partial<CoverageInput> = {}): CoverageInput => ({
  items: [item('i1', '1', 'Finance', null), item('i1a', '1.1', 'Ledger', '1'), item('i9', '9', 'Asset Management', null), item('i91', '9.1', 'Asset Health', '9'), item('i92', '9.2', 'Investment', '9')],
  sectorMapIds: new Set(['m4', 'm3']),
  sectorLinks: [],
  generalLinks: [],
  itemCapability: new Map(),
  products: new Map([['a', product('a', true)], ['b', product('b', false)]]),
  ...over,
});

describe('buildCoverage', () => {
  it('counts a link at the same code in any version of the sector, and not in another sector', () => {
    const result = buildCoverage(input({ sectorLinks: [{ productId: 'a', mapId: 'm3', code: '9.1' }, { productId: 'a', mapId: 'other', code: '9.2' }] }));
    const rows = result.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.code === '9.1')?.state).toBe('published');
    expect(rows.find((r) => r.code === '9.2')?.state).toBe('none');
  });
  it('keeps drafts apart from published, and says draft only when nothing is published', () => {
    const result = buildCoverage(input({ sectorLinks: [{ productId: 'b', mapId: 'm4', code: '9.1' }, { productId: 'a', mapId: 'm4', code: '9.2' }, { productId: 'b', mapId: 'm4', code: '9.2' }] }));
    const rows = result.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.code === '9.1')?.state).toBe('draft_only');
    const both = rows.find((r) => r.code === '9.2');
    expect(both?.state).toBe('published');
    expect(both?.published.map((p) => p.id)).toEqual(['a']);
    expect(both?.drafts.map((p) => p.id)).toEqual(['b']);
    expect(result.counts).toEqual({ total: 5, published: 1, draftOnly: 1, none: 3 });
  });
  it('counts a shared link through the capability identity, on general capabilities first', () => {
    const result = buildCoverage(input({ generalLinks: [{ productId: 'a', capabilityId: 'cap-fin' }], itemCapability: new Map([['i1', 'cap-fin']]) }));
    expect(result.groups[0]?.general).toBe(true);
    expect(result.groups[0]?.rows.find((r) => r.code === '1')?.state).toBe('published');
    expect(result.groups[0]?.rows.find((r) => r.code === '1.1')?.state).toBe('none');
  });
  it('ignores products that are not countable (merged, platforms) and groups sector areas by their top-level capability', () => {
    const result = buildCoverage(input({ sectorLinks: [{ productId: 'gone', mapId: 'm4', code: '9.1' }] }));
    expect(result.groups.map((g) => g.title)).toEqual(['General capabilities (shared by every sector)', '9 Asset Management']);
    expect(result.groups[1]?.counts).toEqual({ total: 3, published: 0, draftOnly: 0, none: 3 });
  });
});
