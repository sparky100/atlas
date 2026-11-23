/**
 * Deterministic "is this the same product as a reviewed catalogue entry?"
 * check. It compares the page's host with the catalogue claim's own source
 * hosts, and the page's provider title with the product or vendor name. It
 * never asks a model to judge, and an uncertain page is left unclassified
 * rather than dressed up as a match.
 */
import type { WebResearchCandidate } from '../../contracts/webResearch';

export interface KnownCatalogueProduct {
  product: string;
  vendor: string;
  /** The reviewed claims' source URLs for this product. */
  sourceUrls: readonly string[];
}

/** The lower-case host without a leading www., or '' when the value is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function containsName(haystack: string, needle: string): boolean {
  const name = needle.trim().toLowerCase();
  return name !== '' && haystack.toLowerCase().includes(name);
}

/** Union of product lists, keyed by vendor and product, with their source hosts merged. */
export function mergeKnownCatalogueProducts(
  ...groups: readonly (readonly KnownCatalogueProduct[])[]
): KnownCatalogueProduct[] {
  const byProduct = new Map<string, KnownCatalogueProduct>();
  for (const group of groups) {
    for (const product of group) {
      const key = `${product.vendor}\u0000${product.product}`;
      const existing = byProduct.get(key);
      byProduct.set(key, existing === undefined
        ? product
        : { ...existing, sourceUrls: [...new Set([...existing.sourceUrls, ...product.sourceUrls])] });
    }
  }
  return [...byProduct.values()];
}

export function catalogueMatchFor(
  candidate: Pick<WebResearchCandidate, 'url' | 'title' | 'publisher'>,
  products: readonly KnownCatalogueProduct[],
): KnownCatalogueProduct | null {
  const host = hostOf(candidate.url);
  for (const product of products) {
    const sameHost = host !== '' && product.sourceUrls.some((url) => hostOf(url) === host);
    const sameName = containsName(candidate.title, product.product) || containsName(candidate.publisher, product.vendor);
    if (sameHost || sameName) return product;
  }
  return null;
}
