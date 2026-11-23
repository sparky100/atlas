import { describe, expect, it } from 'vitest';
import { catalogueMatchFor, hostOf, mergeKnownCatalogueProducts, type KnownCatalogueProduct } from './researchCatalogueMatches';

const oracle: KnownCatalogueProduct = {
  product: 'Oracle Utilities Customer Care and Billing',
  vendor: 'Oracle',
  sourceUrls: ['https://www.oracle.com/uk/industries/utilities/customer-care/'],
};
const xylem: KnownCatalogueProduct = {
  product: 'Xylem Vue',
  vendor: 'Xylem',
  sourceUrls: ['https://www.xylem.com/en-uk/catalog/products--services/digital-water/xylem-vue/'],
};

const candidate = (url: string, title: string, publisher = '') => ({ url, title, publisher, excerpt: null, retrievedAt: '2026-11-23T00:00:00Z' });

describe('hostOf', () => {
  it('removes a leading www. and lower-cases the host', () => {
    expect(hostOf('https://WWW.Oracle.com/uk')).toBe('oracle.com');
  });

  it('returns an empty string for a value that is not a URL', () => {
    expect(hostOf('not a url')).toBe('');
  });
});

describe('catalogueMatchFor', () => {
  it('matches when the page host is one of the product claim hosts', () => {
    expect(catalogueMatchFor(candidate('https://www.oracle.com/uk/utilities', 'Customer care'), [oracle, xylem])).toEqual(oracle);
  });

  it('matches when the provider title names the product', () => {
    expect(catalogueMatchFor(candidate('https://example.com/a', 'Xylem Vue digital water'), [oracle, xylem])).toEqual(xylem);
  });

  it('matches when the publisher names the vendor', () => {
    expect(catalogueMatchFor(candidate('https://example.com/a', 'Utilities billing', 'Oracle'), [oracle, xylem])).toEqual(oracle);
  });

  it('returns null for an unrelated page rather than guessing', () => {
    expect(catalogueMatchFor(candidate('https://example.com/a', 'A regulator guidance note'), [oracle, xylem])).toBeNull();
  });
});

describe('mergeKnownCatalogueProducts', () => {
  it('deduplicates by vendor and product and unions their source hosts', () => {
    const merged = mergeKnownCatalogueProducts(
      [oracle],
      [{ ...oracle, sourceUrls: ['https://docs.oracle.com/care'] }],
      [xylem],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.sourceUrls).toEqual(['https://www.oracle.com/uk/industries/utilities/customer-care/', 'https://docs.oracle.com/care']);
  });
});
