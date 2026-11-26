import { describe, expect, it } from 'vitest';
import { catalogueDraftContentSchema, catalogueProductContentSchema } from './catalogueAdmin';

const claim = {
  position: 1,
  kind: 'functional' as const,
  statement: 'The vendor describes the product as an online checkout.',
  sourceUrl: 'https://example.com/product',
  sourceDate: '2026-11-21',
};

describe('catalogue admin contracts', () => {
  const product = { code: 'product-x', product: 'Product', vendor: 'Vendor', summary: 'A product.', capabilities: [] };

  it('lets the editor ask for a review but never name the reviewer', () => {
    expect(catalogueProductContentSchema.safeParse({ ...product, claims: [{ ...claim, review: true }] }).success).toBe(true);
    expect(catalogueProductContentSchema.safeParse({ ...product, claims: [{ ...claim, reviewedBy: 'Someone else' }] }).success).toBe(false);
    expect(catalogueProductContentSchema.safeParse({ ...product, claims: [{ ...claim, reviewedAt: '2026-11-22' }] }).success).toBe(false);
  });

  it('accepts shared capability links, once each, and nothing else on them', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const link = { capabilityId: id, howItSupports: 'Runs the general ledger' };
    expect(catalogueProductContentSchema.safeParse({ ...product, generalCapabilities: [link], claims: [claim] }).success).toBe(true);
    expect(catalogueProductContentSchema.safeParse({ ...product, claims: [claim] }).success).toBe(true);
    expect(catalogueProductContentSchema.safeParse({ ...product, generalCapabilities: [link, link], claims: [claim] }).success).toBe(false);
    expect(catalogueProductContentSchema.safeParse({ ...product, generalCapabilities: [{ ...link, capabilityId: 'not-an-id' }], claims: [claim] }).success).toBe(false);
    expect(catalogueProductContentSchema.safeParse({ ...product, generalCapabilities: [{ ...link, extra: 1 }], claims: [claim] }).success).toBe(false);
  });

  it('refuses a claim source that is not a public HTTPS link', () => {
    expect(catalogueProductContentSchema.safeParse({ ...product, claims: [{ ...claim, sourceUrl: 'http://example.com/a' }] }).success).toBe(false);
    expect(catalogueProductContentSchema.safeParse({ ...product, claims: [{ ...claim, sourceUrl: 'https://user:pw@example.com/a' }] }).success).toBe(false);
  });

  it('accepts one product with links into more than one capability set', () => {
    const parsed = catalogueProductContentSchema.parse({
      code: 'shopify-plus',
      product: 'Shopify Plus',
      vendor: 'Shopify',
      summary: 'An enterprise commerce platform.',
      capabilities: [
        { capabilityMapId: '11111111-1111-4111-8111-111111111111', capabilityCode: '12.1', capabilityName: 'Website & App Experience', howItSupports: 'Runs online storefronts' },
        { capabilityMapId: '22222222-2222-4222-8222-222222222222', capabilityCode: '9.1', capabilityName: 'Digital Storefront', howItSupports: 'Runs the storefront' },
      ],
      claims: [claim],
    });
    expect(parsed.capabilities).toHaveLength(2);
  });

  it('accepts a product while it is still being prepared, before any claims exist', () => {
    expect(catalogueProductContentSchema.safeParse({
      code: 'new-product', product: 'New Product', vendor: 'Vendor', summary: 'A product being prepared.',
      capabilities: [], claims: [],
    }).success).toBe(true);
  });

  it('rejects a duplicate capability link and duplicate claim position', () => {
    const result = catalogueProductContentSchema.safeParse({
      code: 'shopify-plus', product: 'Shopify Plus', vendor: 'Shopify', summary: 'An enterprise commerce platform.',
      capabilities: [
        { capabilityMapId: '11111111-1111-4111-8111-111111111111', capabilityCode: '12.1', capabilityName: 'Website', howItSupports: 'Runs it' },
        { capabilityMapId: '11111111-1111-4111-8111-111111111111', capabilityCode: '12.1', capabilityName: 'Website', howItSupports: 'Runs it again' },
      ],
      claims: [claim, { ...claim, statement: 'Another claim.' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects prices in ordinary product text', () => {
    expect(catalogueProductContentSchema.safeParse({
      code: 'p', product: 'Product', vendor: 'Vendor', summary: 'Costs £10 per user each month.',
      capabilities: [], claims: [],
    }).success).toBe(false);
  });

  it('accepts an empty draft and rejects a product listed twice', () => {
    expect(catalogueDraftContentSchema.safeParse({
      sector: 'retail_ecommerce', version: 1, capabilityMapVersion: 1,
      title: 'Retail catalogue', sourceDescription: 'Reviewed products.', productIds: [],
    }).success).toBe(true);
    expect(catalogueDraftContentSchema.safeParse({
      sector: 'retail_ecommerce', version: 1, capabilityMapVersion: 1,
      title: 'Retail catalogue', sourceDescription: 'Reviewed products.',
      productIds: ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'],
    }).success).toBe(false);
  });
});
