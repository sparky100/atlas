/**
 * The deterministic sibling-display-order comparator, lifted out of
 * `src/ui/capabilityMap/layout.ts` (F6/ADR-023) so a value stream's stages
 * can sort the same way a capability's siblings already do, without a
 * `value_stream`-specific reimplementation. Generic over `ElementsHeadRow`
 * — it only ever reads `attributes.order`/`attributes.code`/`name`/
 * `element_id`, none of which is capability-specific — so this is a
 * relocation, not a new algorithm: `layout.ts`'s own `compareCapabilities`
 * is now a thin re-export of `compareBySiblingOrder` below, and every
 * existing caller/test of that name is unaffected.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

/** Splits a dotted code (`"2.10"`) into comparable numeric groups so `2.2` sorts before `2.10` — a plain string compare would put `2.10` first. Falls back to string comparison wherever a segment isn't numeric. */
function compareCodes(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = as[i] ?? '';
    const bv = bs[i] ?? '';
    const an = Number(av);
    const bn = Number(bv);
    if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    if (av !== bv) return av.localeCompare(bv);
  }
  return 0;
}

function codeOf(element: ElementsHeadRow): string | null {
  const code = attributesRecord(element.attributes).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

function orderOf(element: ElementsHeadRow): number | null {
  const order = attributesRecord(element.attributes).order;
  return typeof order === 'number' ? order : null;
}

/**
 * Deterministic sibling order: by `attributes.order` (Sprint U4-1 C1) when
 * both elements have one; falls back to `code` (numeric-aware) when either
 * lacks an order, then name, then id as the final tiebreak. See
 * `layout.ts`'s own `compareCapabilities` (this function's original home)
 * for the fuller reasoning on why an unordered element sorts last, not
 * first, among ordered siblings.
 */
export function compareBySiblingOrder(a: ElementsHeadRow, b: ElementsHeadRow): number {
  const orderA = orderOf(a);
  const orderB = orderOf(b);
  if (orderA !== null && orderB !== null) {
    if (orderA !== orderB) return orderA - orderB;
  } else if (orderA !== null) {
    return -1;
  } else if (orderB !== null) {
    return 1;
  }

  const codeA = codeOf(a);
  const codeB = codeOf(b);
  if (codeA !== null && codeB !== null) {
    const byCode = compareCodes(codeA, codeB);
    if (byCode !== 0) return byCode;
  }
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}
