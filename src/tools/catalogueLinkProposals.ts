/**
 * Catalogue step 6b: propose links from products already in the library to the
 * capabilities of one capability set. Pure rules, no AI: a link is proposed when
 * a product is already linked to a capability with the same code in another
 * version of the same sector's set, or to a capability with the same name in
 * any set. Each proposal says why, so a person can judge it. A general
 * capability (codes 1 to 8) links through its shared identity, so it is never
 * proposed. A pair a person rejected is not proposed again.
 */

export const SET_RUN_MAX_CAPABILITIES = 10;

export interface ProposalSet { id: string; sector: string; version: number; title: string | null }
export interface ProposalItem { code: string; name: string }
export interface ProductLinkRow { productId: string; mapId: string; code: string; name: string; howItSupports: string }
export interface ProposalProduct { id: string; product: string; vendor: string }
export interface RejectedLinkRow { productId: string; mapId: string; code: string; name: string }

export interface LinkProposal {
  key: string;
  productId: string;
  product: string;
  vendor: string;
  code: string;
  name: string;
  howItSupports: string;
  why: string;
}

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const isGeneral = (code: string) => /^[1-8](\.|$)/.test(code);
export const proposalKey = (productId: string, code: string) => `${productId}\u0000${code}`;

function setName(set: ProposalSet | undefined): string {
  return set === undefined ? 'another set' : `${set.title ?? 'a capability set'} v${String(set.version)}`;
}

/** Links to propose for the capabilities of `target`, from the library. */
export function proposeLinks(
  target: ProposalSet,
  items: readonly ProposalItem[],
  products: readonly ProposalProduct[],
  links: readonly ProductLinkRow[],
  sets: readonly ProposalSet[],
  rejected: readonly RejectedLinkRow[],
): LinkProposal[] {
  const setById = new Map(sets.map((set) => [set.id, set]));
  const linksByProduct = new Map<string, ProductLinkRow[]>();
  for (const link of links) {
    const list = linksByProduct.get(link.productId) ?? [];
    list.push(link);
    linksByProduct.set(link.productId, list);
  }
  const rejectedByProduct = new Map<string, RejectedLinkRow[]>();
  for (const row of rejected) {
    const list = rejectedByProduct.get(row.productId) ?? [];
    list.push(row);
    rejectedByProduct.set(row.productId, list);
  }
  const out: LinkProposal[] = [];
  for (const product of products) {
    const own = linksByProduct.get(product.id) ?? [];
    const turnedDown = rejectedByProduct.get(product.id) ?? [];
    for (const item of items) {
      if (isGeneral(item.code)) continue;
      const name = norm(item.name);
      const alreadyHere = own.some((link) => link.mapId === target.id && (link.code === item.code || norm(link.name) === name));
      if (alreadyHere) continue;
      if (turnedDown.some((row) => (row.mapId === target.id && row.code === item.code) || norm(row.name) === name)) continue;
      const sameName = own.find((link) => link.mapId !== target.id && norm(link.name) === name);
      const sameCode = own.find((link) => {
        if (link.mapId === target.id || link.code !== item.code) return false;
        return setById.get(link.mapId)?.sector === target.sector;
      });
      const basis = sameName ?? sameCode;
      if (basis === undefined) continue;
      const from = setName(setById.get(basis.mapId));
      const why = sameName !== undefined
        ? `The same name as the link in ${from}.`
        : `The same code (${item.code}) as “${basis.name}” in ${from}, where this product is linked.`;
      out.push({ key: proposalKey(product.id, item.code), productId: product.id, product: product.product, vendor: product.vendor, code: item.code, name: item.name, howItSupports: basis.howItSupports, why });
    }
  }
  return out.sort((a, b) => a.product.localeCompare(b.product) || a.code.localeCompare(b.code));
}

/** The set's capabilities that no product is linked to, general capabilities aside (they link through their shared identity). */
export function capabilitiesWithoutProduct(target: ProposalSet, items: readonly ProposalItem[], links: readonly ProductLinkRow[]): ProposalItem[] {
  const linked = new Set(links.filter((link) => link.mapId === target.id).map((link) => link.code));
  return items.filter((item) => !isGeneral(item.code) && !linked.has(item.code));
}

export interface SetCounts { capabilities: number; withProduct: number; without: number; proposed: number }

export function setCounts(target: ProposalSet, items: readonly ProposalItem[], links: readonly ProductLinkRow[], proposals: readonly LinkProposal[]): SetCounts {
  const candidates = items.filter((item) => !isGeneral(item.code));
  const without = capabilitiesWithoutProduct(target, items, links).length;
  return { capabilities: candidates.length, withProduct: candidates.length - without, without, proposed: proposals.length };
}

/** A library product the search found again becomes a proposed link to the capability it was found for, unless it is already linked or the pair was rejected. */
export function proposalFromFound(
  found: { productId: string; product: string; vendor: string; howItSupports: string },
  capability: ProposalItem,
  target: ProposalSet,
  links: readonly ProductLinkRow[],
  rejected: readonly RejectedLinkRow[],
): LinkProposal | null {
  const name = norm(capability.name);
  if (links.some((link) => link.productId === found.productId && link.mapId === target.id && (link.code === capability.code || norm(link.name) === name))) return null;
  if (rejected.some((row) => row.productId === found.productId && ((row.mapId === target.id && row.code === capability.code) || norm(row.name) === name))) return null;
  return {
    key: proposalKey(found.productId, capability.code), productId: found.productId, product: found.product, vendor: found.vendor,
    code: capability.code, name: capability.name, howItSupports: found.howItSupports,
    why: 'The Researcher found this product again while searching for this capability.',
  };
}
