/**
 * Sprint U4-2a item 4's "cards with Preview (read-only tree)" — turns a
 * flat `capability_map_items` result (`listCapabilityMapItems`, already
 * how `useCapabilityImport.ts`'s own import step reads a map's items)
 * into a nested tree for the picker card's own disclosure, before a
 * model has ever been seeded from it. Deliberately its own small builder
 * rather than reusing `layout.ts`'s `computeCapabilityMapTree`: that one
 * works on `ElementsHeadRow` (a real, committed model element —
 * `element_id`, `attributes.order`, `parent_id`) and folds in orphan
 * handling a *content* item can never need (the Zod schema
 * — `src/contracts/capabilityMapContent.ts` — already guarantees every
 * item's `parentCode` resolves and its `level` is exactly one more than
 * its parent's, before a file is ever loaded at all).
 */
import type { CapabilityMapItemRow } from '../../db/capabilityMapTemplates';

export interface CapabilityMapPreviewNode {
  item: CapabilityMapItemRow;
  children: CapabilityMapPreviewNode[];
}

function compareItems(a: CapabilityMapItemRow, b: CapabilityMapItemRow): number {
  return a.item_order - b.item_order || a.code.localeCompare(b.code);
}

/** Root-level nodes (`parent_code: null`), each with its own children nested below it — display order throughout is `item_order` then `code` (this repo's own tiebreak convention, `layout.ts`'s `compareCapabilities`). */
export function buildCapabilityMapPreviewTree(items: readonly CapabilityMapItemRow[]): CapabilityMapPreviewNode[] {
  const byParentCode = new Map<string | null, CapabilityMapItemRow[]>();
  for (const item of items) {
    const list = byParentCode.get(item.parent_code) ?? [];
    list.push(item);
    byParentCode.set(item.parent_code, list);
  }
  for (const list of byParentCode.values()) list.sort(compareItems);

  function build(parentCode: string | null): CapabilityMapPreviewNode[] {
    return (byParentCode.get(parentCode) ?? []).map((item) => ({ item, children: build(item.code) }));
  }
  return build(null);
}
