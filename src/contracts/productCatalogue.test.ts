import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_NO_PRICE_PATTERN, CATALOGUE_SOURCE_URL_PATTERN, containsCataloguePrice, productCatalogueContentSchema } from './productCatalogue';
import { catalogueFromRows, catalogueToRows } from '../db/productCatalogue';
import { catalogueFixture } from './fixtures/productCatalogue';

const sql = readFileSync('supabase/migrations/20261120050000_product_catalogue.sql', 'utf8');
describe('reviewed catalogue contract', () => {
  it('round-trips a content file through all four table contracts', () => {
    const content = productCatalogueContentSchema.parse(catalogueFixture);
    expect(catalogueFromRows(catalogueToRows(content, randomUUID, '2026-11-20T10:00:00Z'))).toEqual(content);
  });
  it('uses exactly the same portable patterns in SQL and TypeScript', () => {
    const patterns = [...sql.matchAll(/\$price\$(.*?)\$price\$/g)].map((m) => m[1]);
    expect(patterns).toHaveLength(14);
    for (const p of patterns) expect(p).toBe(CATALOGUE_NO_PRICE_PATTERN);
    expect(sql.match(/\$url\$(.*?)\$url\$/)?.[1]).toBe(CATALOGUE_SOURCE_URL_PATTERN);
  });
  it.each(['£50', 'USD', 'price', 'pricing', 'low cost', 'Fees', 'per user', 'free of charge', 'EUR20', 'twenty dollars'])('excludes money text: %s', (value) => {
    expect(containsCataloguePrice(value)).toBe(true);
  });
  it.each(['Subscription service', 'Quotation tracking', 'Costello Systems', 'User permissions'])('retains non-price text: %s', (value) => {
    expect(containsCataloguePrice(value)).toBe(false);
  });
  it.each(['http://example.com/x', 'https://user@example.com/x', 'https://example.com:443/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://example.com/a b', 'https://example.com/pricing'])('rejects unsuitable sources: %s', (sourceUrl) => {
    const fixture = structuredClone(catalogueFixture);
    fixture.entries[0]!.claims[0]!.sourceUrl = sourceUrl;
    expect(productCatalogueContentSchema.safeParse(fixture).success).toBe(false);
  });
  it('rejects duplicate evidence positions, duplicate capability codes, and review before source', () => {
    const fixture = structuredClone(catalogueFixture);
    const e = fixture.entries[0]!;
    e.claims.push({ ...e.claims[0]!, reviewedAt: '2026-01-01' });
    e.capabilities.push({ ...e.capabilities[0]! });
    expect(productCatalogueContentSchema.safeParse(fixture).success).toBe(false);
  });
});
