import { describe, expect, it } from 'vitest';
import { buildCapabilityMapPreviewTree } from './previewTree';
import type { CapabilityMapItemRow } from '../../db/capabilityMapTemplates';

function item(overrides: Partial<CapabilityMapItemRow> & Pick<CapabilityMapItemRow, 'code' | 'parent_code' | 'item_order'>): CapabilityMapItemRow {
  return {
    id: `id-${overrides.code}`,
    map_id: 'map-1',
    name: `Item ${overrides.code}`,
    description: null,
    level: overrides.parent_code === null ? 1 : 2,
    ...overrides,
  };
}

describe('buildCapabilityMapPreviewTree', () => {
  it('nests children under their parent, in item_order', () => {
    const items = [
      item({ code: '2', parent_code: null, item_order: 20 }),
      item({ code: '1', parent_code: null, item_order: 10 }),
      item({ code: '1.2', parent_code: '1', item_order: 20 }),
      item({ code: '1.1', parent_code: '1', item_order: 10 }),
    ];

    const tree = buildCapabilityMapPreviewTree(items);

    expect(tree.map((n) => n.item.code)).toEqual(['1', '2']);
    expect(tree[0]?.children.map((n) => n.item.code)).toEqual(['1.1', '1.2']);
    expect(tree[1]?.children).toEqual([]);
  });

  it('breaks a tied item_order by code', () => {
    const items = [
      item({ code: 'b', parent_code: null, item_order: 10 }),
      item({ code: 'a', parent_code: null, item_order: 10 }),
    ];

    const tree = buildCapabilityMapPreviewTree(items);

    expect(tree.map((n) => n.item.code)).toEqual(['a', 'b']);
  });

  it('nests three levels deep', () => {
    const items = [
      item({ code: '1', parent_code: null, item_order: 10 }),
      item({ code: '1.1', parent_code: '1', item_order: 10 }),
      item({ code: '1.1.1', parent_code: '1.1', item_order: 10, level: 3 }),
    ];

    const tree = buildCapabilityMapPreviewTree(items);

    expect(tree[0]?.children[0]?.children.map((n) => n.item.code)).toEqual(['1.1.1']);
  });

  it('returns an empty tree for no items', () => {
    expect(buildCapabilityMapPreviewTree([])).toEqual([]);
  });
});
