import type { CapabilityMapContent } from '../../contracts/capabilityMapContent';

export type CapabilitySetItem = CapabilityMapContent['items'][number];

/**
 * Depth-first order by parent, then `order`, then name. An item whose parent
 * is missing is kept at the end rather than silently dropped, so a broken
 * tree is still editable.
 */
export function treeOrder(items: CapabilitySetItem[]): CapabilitySetItem[] {
  const result: CapabilitySetItem[] = [];
  const visited = new Set<string>();
  function visit(parent: string | null): void {
    for (const item of items
      .filter((candidate) => candidate.parentCode === parent)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
      if (visited.has(item.code)) continue;
      visited.add(item.code);
      result.push(item);
      visit(item.code);
    }
  }
  visit(null);
  return [...result, ...items.filter((item) => !visited.has(item.code))];
}
