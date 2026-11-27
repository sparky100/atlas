import { describe, expect, it } from 'vitest';
import type { CatalogueProductContent } from '../contracts/catalogueAdmin';
import { splitByLibrary } from './catalogueFindProducts';
import { addDays, duplicateCandidates, isKept, mergeProductContent, movedLinkIsSameSite } from './catalogueResultActions';

const product = (over: Partial<CatalogueProductContent>): CatalogueProductContent => ({
  code: 'a-product', product: 'A product', vendor: 'Vendor', summary: 'Summary.', capabilities: [], claims: [], ...over,
});

describe('moved links', () => {
  it('accepts a move on the same site that keeps the first part of the path', () => {
    expect(movedLinkIsSameSite('https://business.adobe.com/uk/products/magento/magento-commerce.html', 'https://business.adobe.com/uk/products/commerce.html')).toBe(true);
  });
  it('does not accept a move to another site, a different section, a home page or a section page', () => {
    expect(movedLinkIsSameSite('https://a.example/x/y', 'https://b.example/x/y')).toBe(false);
    expect(movedLinkIsSameSite('https://www.masabi.com/rail-ticketing-system/', 'https://www.masabi.com/solutions/')).toBe(false);
    expect(movedLinkIsSameSite('https://copperleaf.com/solutions-for-industry/electric', 'https://www.copperleaf.com/industries-we-serve/electric-utility/')).toBe(false);
    expect(movedLinkIsSameSite('https://a.example/x/y', 'https://a.example/')).toBe(false);
    expect(movedLinkIsSameSite('https://a.example/x/y', null)).toBe(false);
    expect(movedLinkIsSameSite('https://a.example/x/y', 'http://a.example/x/z')).toBe(false);
  });
  it('treats www as the same site', () => {
    expect(movedLinkIsSameSite('https://example.com/docs/a', 'https://www.example.com/docs/b/c')).toBe(true);
  });
});

describe('kept links', () => {
  it('stays hidden until the date', () => {
    const now = new Date('2026-11-27T10:00:00Z');
    expect(isKept(addDays(now, 30), now)).toBe(true);
    expect(isKept('2026-11-01T00:00:00Z', now)).toBe(false);
    expect(isKept(null, now)).toBe(false);
  });
});

describe('possible duplicates', () => {
  it('finds the same product with and without the vendor name in front', () => {
    const pairs = duplicateCandidates([
      { id: '1', product: 'ArcGIS Utility Network', vendor: 'Esri' },
      { id: '2', product: 'Esri ArcGIS Utility Network', vendor: 'Esri' },
      { id: '3', product: 'ArcGIS Law Enforcement', vendor: 'Esri' },
      { id: '4', product: 'ArcGIS Utility Network', vendor: 'Someone else' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ how: 'same' });
    expect([pairs[0]?.a.id, pairs[0]?.b.id].sort()).toEqual(['1', '2']);
  });
  it('lists a name that sits inside another, and leaves different products alone', () => {
    const pairs = duplicateCandidates([
      { id: '1', product: 'Axon Evidence', vendor: 'Axon' },
      { id: '2', product: 'Axon Evidence Pro', vendor: 'Axon' },
      { id: '3', product: 'Axon Body', vendor: 'Axon' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.how).toBe('contains');
  });
  it('lets Find products see the prefixed name as the product already in the library', () => {
    const split = splitByLibrary([{ vendor: 'Esri', product: 'ArcGIS Utility Network' }], [{ id: 'lib', vendor: 'Esri', product: 'Esri ArcGIS Utility Network' }]);
    expect(split.existing).toEqual([{ vendor: 'Esri', product: 'ArcGIS Utility Network', productId: 'lib' }]);
    expect(split.added).toEqual([]);
  });
  it('does not treat a longer product name as the same product when finding', () => {
    const split = splitByLibrary([{ vendor: 'Axon', product: 'Axon Evidence' }], [{ id: 'lib', vendor: 'Axon', product: 'Axon Evidence Pro' }]);
    expect(split.existing).toEqual([]);
    expect(split.added).toHaveLength(1);
  });
});

describe('merging', () => {
  const link = { capabilityMapId: '11111111-1111-4111-8111-111111111111', capabilityCode: '12.1', capabilityName: 'Billing', howItSupports: 'It bills.' };
  const claim = (position: number, statement: string, sourceUrl = 'https://example.test/a') => ({ position, kind: 'functional' as const, statement, sourceUrl, sourceDate: '2026-11-01' });

  it('adds only the links and claims the kept product lacks, as new claims after its own', () => {
    const kept = product({ capabilities: [link], claims: [claim(1, 'Same claim.')] });
    const merged = product({
      capabilities: [link, { ...link, capabilityCode: '12.2', capabilityName: 'Metering' }],
      claims: [claim(1, 'same claim.'), claim(2, 'A different claim.', 'https://example.test/b')],
    });
    const result = mergeProductContent(kept, merged);
    if ('error' in result) throw new Error(result.error);
    expect(result.addedLinks).toBe(1);
    expect(result.addedClaims).toBe(1);
    expect(result.content.claims.map((item) => [item.position, item.statement])).toEqual([[1, 'Same claim.'], [2, 'A different claim.']]);
    expect(result.content.code).toBe('a-product');
  });
  it('refuses when the result would be too big for one product', () => {
    const many = Array.from({ length: 150 }, (_, index) => claim(index + 1, `Claim ${String(index)}.`));
    const other = Array.from({ length: 150 }, (_, index) => claim(index + 1, `Other claim ${String(index)}.`));
    const result = mergeProductContent(product({ claims: many }), product({ claims: other }));
    expect('error' in result).toBe(true);
  });
});
