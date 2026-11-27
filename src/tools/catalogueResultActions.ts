/**
 * Pure rules for the catalogue results screen: which moved links are safe to
 * accept together, which library products look like the same product under two
 * names, and what merging one into the other would carry across. No I/O.
 */
import { CATALOGUE_PRODUCT_LIMITS, type CatalogueProductContent } from '../contracts/catalogueAdmin';
import { productNameKey, vendorKey } from './catalogueNameKey';

/** Days a link stays out of the list after "Keep the old address" and after "Keep for now". */
export const KEEP_OLD_ADDRESS_DAYS = 90;
export const KEEP_FOR_NOW_DAYS = 30;

function containsWords(longer: string, shorter: string): boolean {
  return shorter !== '' && ` ${longer} `.includes(` ${shorter} `);
}

export interface DuplicateCandidate {
  a: { id: string; product: string; vendor: string };
  b: { id: string; product: string; vendor: string };
  /** `same` when the names are the same once a leading vendor name is ignored; `contains` when one name sits inside the other. */
  how: 'same' | 'contains';
}

/** Pairs of products by the same vendor whose names are the same or sit inside one another. Pairs already merged are left out by the caller. */
export function duplicateCandidates(products: readonly { id: string; product: string; vendor: string }[]): DuplicateCandidate[] {
  const byVendor = new Map<string, { id: string; product: string; vendor: string; key: string }[]>();
  for (const product of products) {
    const key = vendorKey(product.vendor);
    byVendor.set(key, [...(byVendor.get(key) ?? []), { ...product, key: productNameKey(product.vendor, product.product) }]);
  }
  const out: DuplicateCandidate[] = [];
  for (const group of byVendor.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        if (a === undefined || b === undefined) continue;
        const same = a.key === b.key;
        if (same || containsWords(a.key, b.key) || containsWords(b.key, a.key)) {
          out.push({ a: { id: a.id, product: a.product, vendor: a.vendor }, b: { id: b.id, product: b.product, vendor: b.vendor }, how: same ? 'same' : 'contains' });
        }
      }
    }
  }
  return out.sort((x, y) => x.a.vendor.localeCompare(y.a.vendor) || x.a.product.localeCompare(y.a.product));
}

export interface MergeResult {
  content: CatalogueProductContent;
  addedLinks: number;
  addedSharedLinks: number;
  addedClaims: number;
}

/**
 * What the kept product looks like once the other one is merged into it: every
 * capability link and claim the kept product does not already have is added.
 * Claims arrive as new drafts for the person to review. Returns an error
 * sentence when the result would exceed a product's limits.
 */
export function mergeProductContent(kept: CatalogueProductContent, merged: CatalogueProductContent): MergeResult | { error: string } {
  const haveLink = new Set(kept.capabilities.map((link) => `${link.capabilityMapId}\u0000${link.capabilityCode}`));
  const links = merged.capabilities.filter((link) => !haveLink.has(`${link.capabilityMapId}\u0000${link.capabilityCode}`));
  const haveShared = new Set((kept.generalCapabilities ?? []).map((link) => link.capabilityId));
  const shared = (merged.generalCapabilities ?? []).filter((link) => !haveShared.has(link.capabilityId));
  const haveClaim = new Set(kept.claims.map((claim) => `${claim.sourceUrl.trim()}\u0000${claim.statement.trim().toLowerCase()}`));
  const claims = merged.claims.filter((claim) => !haveClaim.has(`${claim.sourceUrl.trim()}\u0000${claim.statement.trim().toLowerCase()}`));
  const capabilityTotal = kept.capabilities.length + links.length;
  const sharedTotal = (kept.generalCapabilities ?? []).length + shared.length;
  const claimTotal = kept.claims.length + claims.length;
  if (capabilityTotal > CATALOGUE_PRODUCT_LIMITS.capabilities || sharedTotal > CATALOGUE_PRODUCT_LIMITS.generalCapabilities || claimTotal > CATALOGUE_PRODUCT_LIMITS.claims) {
    return { error: 'Together they would have more links or claims than one product can hold. Tidy one of them first.' };
  }
  const nextPosition = kept.claims.reduce((highest, claim) => Math.max(highest, claim.position), 0);
  return {
    content: {
      ...kept,
      capabilities: [...kept.capabilities, ...links],
      generalCapabilities: [...(kept.generalCapabilities ?? []), ...shared],
      claims: [
        ...kept.claims,
        ...claims.map((claim, index) => ({ position: nextPosition + index + 1, kind: claim.kind, statement: claim.statement, sourceUrl: claim.sourceUrl, sourceDate: claim.sourceDate })),
      ],
    },
    addedLinks: links.length,
    addedSharedLinks: shared.length,
    addedClaims: claims.length,
  };
}

function hostWithoutWww(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Whether a moved link's new address is safe to accept along with others: the
 * same site (ignoring "www."), the same first part of the path, and more than a
 * bare home page or section page. Anything else is looked at one at a time.
 */
export function movedLinkIsSameSite(oldAddress: string, newAddress: string | null): boolean {
  if (newAddress === null) return false;
  let before: URL;
  let after: URL;
  try {
    before = new URL(oldAddress);
    after = new URL(newAddress);
  } catch {
    return false;
  }
  if (after.protocol !== 'https:' || hostWithoutWww(before) !== hostWithoutWww(after)) return false;
  const was = before.pathname.split('/').filter((part) => part !== '');
  const now = after.pathname.split('/').filter((part) => part !== '');
  if (now.length < 2 || was.length === 0) return false;
  return was[0]?.toLowerCase() === now[0]?.toLowerCase();
}

/** Whether a kept link is still hidden at `now`. */
export function isKept(hiddenUntil: string | null, now: Date): boolean {
  return hiddenUntil !== null && new Date(hiddenUntil).getTime() > now.getTime();
}

export function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
