/**
 * Pure rules for "Suggested platforms": which library products look like
 * components of one platform because their names start the same way ("Oracle
 * Utilities Customer Care and Billing" and "Oracle Utilities Meter Data
 * Management" share "Oracle Utilities"). A suggestion only; a person confirms
 * each one. No I/O.
 */
import { productNameKey, vendorKey, words } from './catalogueNameKey';

export interface SuggestionProduct {
  id: string;
  product: string;
  vendor: string;
  partOfProductId: string | null;
  componentCount: number;
}

export interface PlatformSuggestion {
  /** The words the components share, without the vendor's name: stable, used to remember a rejection. */
  platformKey: string;
  /** What the platform would be called, including the vendor's name when the products' names have it. */
  platformName: string;
  vendor: string;
  /** The library product that already is this platform, or null when it would be added as a draft. */
  platformId: string | null;
  components: { id: string; product: string }[];
}

/** The first tokens of `name` that cover `count` words, keeping the original spelling. */
function leadingName(name: string, count: number): string {
  const tokens = name.trim().split(/\s+/);
  let taken = '';
  for (const token of tokens) {
    taken = taken === '' ? token : `${taken} ${token}`;
    if (words(taken).length >= count) break;
  }
  return taken;
}

function commonPrefix(lists: readonly (readonly string[])[]): string[] {
  const first = lists[0] ?? [];
  let length = first.length;
  for (const list of lists) {
    let shared = 0;
    while (shared < length && shared < list.length && list[shared] === first[shared]) shared += 1;
    length = shared;
  }
  return first.slice(0, length);
}

/**
 * Groups of at least two products by the same vendor whose names start with the
 * same word, named by the words they all share. `rejected` holds
 * `${productId}|${platformKey}` for pairs a person turned down.
 */
export function suggestPlatforms(products: readonly SuggestionProduct[], rejected: ReadonlySet<string>): PlatformSuggestion[] {
  const byVendor = new Map<string, SuggestionProduct[]>();
  for (const product of products) {
    const key = vendorKey(product.vendor);
    byVendor.set(key, [...(byVendor.get(key) ?? []), product]);
  }
  const out: PlatformSuggestion[] = [];
  for (const group of byVendor.values()) {
    const keyed = group.map((product) => ({ product, key: productNameKey(product.vendor, product.product) })).filter((row) => row.key !== '');
    const byFirstWord = new Map<string, typeof keyed>();
    for (const row of keyed) {
      const first = row.key.split(' ')[0] ?? '';
      byFirstWord.set(first, [...(byFirstWord.get(first) ?? []), row]);
    }
    for (const rows of byFirstWord.values()) {
      // A product that is already a component of something is not offered again; a platform can gain more components.
      const free = rows.filter((row) => row.product.partOfProductId === null);
      const prefix = commonPrefix(free.map((row) => row.key.split(' ')));
      if (prefix.length === 0) continue;
      const prefixKey = prefix.join(' ');
      const existing = free.find((row) => row.key === prefixKey)?.product ?? null;
      const seen = new Set<string>();
      const components = free
        .filter((row) => row.key !== prefixKey && row.product.componentCount === 0 && !rejected.has(`${row.product.id}|${prefixKey}`))
        .filter((row) => { if (seen.has(row.key)) return false; seen.add(row.key); return true; })
        .map((row) => ({ id: row.product.id, product: row.product.product }));
      if (components.length < 2 && !(existing !== null && components.length >= 1)) continue;
      const sample = free.find((row) => row.key !== prefixKey)?.product ?? free[0]?.product;
      if (sample === undefined) continue;
      const leadLength = words(sample.product).length - words(productNameKey(sample.vendor, sample.product)).length;
      out.push({
        platformKey: prefixKey,
        platformName: existing?.product ?? leadingName(sample.product, leadLength + prefix.length),
        vendor: sample.vendor,
        platformId: existing?.id ?? null,
        components: components.sort((a, b) => a.product.localeCompare(b.product)),
      });
    }
  }
  return out.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.platformName.localeCompare(b.platformName));
}
