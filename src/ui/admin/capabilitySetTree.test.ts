import { describe, expect, it } from 'vitest';
import type { CapabilityMapContent } from '../../contracts/capabilityMapContent';
import { treeOrder } from './capabilitySetTree';

type Item = CapabilityMapContent['items'][number];

function item(code: string, parentCode: string | null, order: number, name = code): Item {
  return { code, name, description: '', level: 1, parentCode, order };
}

describe('treeOrder', () => {
  it('puts each parent before its children and sorts siblings by order, then name', () => {
    const ordered = treeOrder([
      item('child-b', 'parent', 10, 'Zed'),
      item('parent', null, 20),
      item('child-a', 'parent', 10, 'Alpha'),
      item('first', null, 10),
    ]);
    expect(ordered.map((entry) => entry.code)).toEqual(['first', 'parent', 'child-a', 'child-b']);
  });

  it('keeps an item whose parent is missing instead of dropping it', () => {
    const ordered = treeOrder([item('root', null, 10), item('orphan', 'gone', 20)]);
    expect(ordered.map((entry) => entry.code)).toEqual(['root', 'orphan']);
  });
});
