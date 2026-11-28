/**
 * Catalogue coverage: for one published capability set, which capabilities have
 * a product and which have none. Pure rules, no AI, no I/O. A product counts for
 * a capability when it has a link at the same code in any version of that
 * sector's set (the library pins links to a version, a new version carries them
 * over by code) or a shared link to the capability's shared identity. Merged
 * products and platforms are not counted: a platform's modules carry the links,
 * not the platform. "Published" and "draft" are kept apart and never merged.
 */

export interface CoverageItem { id: string; code: string; name: string; parentCode: string | null; level: number }
export interface CoverageProduct { id: string; product: string; vendor: string; published: boolean }
export interface CoverageInput {
  items: readonly CoverageItem[];
  /** Map ids of every version of this set's sector, mapped to the version's items' codes via `sectorLinks`. */
  sectorMapIds: ReadonlySet<string>;
  sectorLinks: readonly { productId: string; mapId: string; code: string }[];
  generalLinks: readonly { productId: string; capabilityId: string }[];
  /** The target set's item id to its shared capability id, where it has one. */
  itemCapability: ReadonlyMap<string, string>;
  /** Products that may be counted (merged products and platforms already left out). */
  products: ReadonlyMap<string, CoverageProduct>;
}

export type CoverageState = 'published' | 'draft_only' | 'none';

export interface CoverageRow {
  id: string;
  code: string;
  name: string;
  level: number;
  state: CoverageState;
  published: CoverageProduct[];
  drafts: CoverageProduct[];
}

export interface CoverageGroup {
  key: string;
  title: string;
  general: boolean;
  rows: CoverageRow[];
  counts: CoverageCounts;
}

export interface CoverageCounts { total: number; published: number; draftOnly: number; none: number }

/** Codes 1 to 8 are the general capabilities, shared by every sector's set. */
export const isGeneralCode = (code: string) => /^[1-8](\.|$)/.test(code);
const rootOf = (code: string) => code.split('.')[0] ?? code;

function countRows(rows: readonly CoverageRow[]): CoverageCounts {
  const published = rows.filter((row) => row.state === 'published').length;
  const draftOnly = rows.filter((row) => row.state === 'draft_only').length;
  return { total: rows.length, published, draftOnly, none: rows.length - published - draftOnly };
}

const byName = (a: CoverageProduct, b: CoverageProduct) => a.product.localeCompare(b.product) || a.vendor.localeCompare(b.vendor);

export function buildCoverage(input: CoverageInput): { groups: CoverageGroup[]; counts: CoverageCounts } {
  const byCode = new Map<string, Set<string>>();
  const add = (code: string, productId: string) => { const set = byCode.get(code) ?? new Set<string>(); set.add(productId); byCode.set(code, set); };
  for (const link of input.sectorLinks) if (input.sectorMapIds.has(link.mapId)) add(link.code, link.productId);
  const byCapability = new Map<string, Set<string>>();
  for (const link of input.generalLinks) {
    const set = byCapability.get(link.capabilityId) ?? new Set<string>();
    set.add(link.productId); byCapability.set(link.capabilityId, set);
  }
  const rows: CoverageRow[] = input.items.map((item) => {
    const ids = new Set<string>(byCode.get(item.code) ?? []);
    const capabilityId = input.itemCapability.get(item.id);
    if (capabilityId !== undefined) for (const id of byCapability.get(capabilityId) ?? []) ids.add(id);
    const products = [...ids].map((id) => input.products.get(id)).filter((product): product is CoverageProduct => product !== undefined).sort(byName);
    const published = products.filter((product) => product.published);
    const drafts = products.filter((product) => !product.published);
    return { id: item.id, code: item.code, name: item.name, level: item.level, state: published.length > 0 ? 'published' : drafts.length > 0 ? 'draft_only' : 'none', published, drafts };
  });
  const order = new Map(input.items.map((item, index) => [item.code, index]));
  const sorted = [...rows].sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  const rootName = new Map(input.items.filter((item) => item.parentCode === null).map((item) => [rootOf(item.code), item.name]));
  const groups: CoverageGroup[] = [];
  const general = sorted.filter((row) => isGeneralCode(row.code));
  if (general.length > 0) groups.push({ key: 'general', title: 'General capabilities (shared by every sector)', general: true, rows: general, counts: countRows(general) });
  const seen = new Map<string, CoverageRow[]>();
  for (const row of sorted) {
    if (isGeneralCode(row.code)) continue;
    const key = rootOf(row.code);
    seen.set(key, [...(seen.get(key) ?? []), row]);
  }
  for (const [key, list] of seen) groups.push({ key, title: `${key} ${rootName.get(key) ?? ''}`.trim(), general: false, rows: list, counts: countRows(list) });
  return { groups, counts: countRows(sorted) };
}
