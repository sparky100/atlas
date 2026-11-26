import { describe, expect, it } from 'vitest';
import type { OptionCatalogueSource } from '../../contracts/optionSource';
import { PRODUCT_DECISION_MAX_PRODUCTS, productDecisionTitle, productsToCarry } from './startProductDecision';

const saved = (over: Partial<OptionCatalogueSource>): OptionCatalogueSource => ({
  kind: 'catalogue', id: 'x', optionId: 'o', branchId: null, citedBy: 'u', citedAt: '', sector: 'electricity_network', version: 1, entryCode: 'esri-un',
  product: 'Esri ArcGIS Utility Network', vendor: 'Esri', summary: 'GIS.', licence: 'CC BY 4.0', standing: 'current', claims: [], ...over,
});
const listed = (entryCode: string, version = 2) => ({ product: entryCode, vendor: 'V', summary: '', sector: 'electricity_network', version, entryCode });

describe('starting the product decision', () => {
  it('names the decision after the Buy option', () => {
    expect(productDecisionTitle('Replace with a product')).toBe('Which product for: Replace with a product?');
    expect(productDecisionTitle('Buy a GIS?')).toBe('Which product for: Buy a GIS?');
  });

  it('carries saved products first, then listed ones, each product once, current citations only', () => {
    const out = productsToCarry(
      [saved({}), saved({ entryCode: 'old', standing: 'withdrawn' })],
      [listed('esri-un'), listed('ge-smallworld')],
    );
    expect(out.map((p) => [p.entryCode, p.version])).toEqual([['esri-un', 1], ['ge-smallworld', 2]]);
  });

  it('stops at the limit; more can be added on the new decision', () => {
    const many = Array.from({ length: PRODUCT_DECISION_MAX_PRODUCTS + 3 }, (_, i) => listed(`p${String(i)}`));
    expect(productsToCarry([], many)).toHaveLength(PRODUCT_DECISION_MAX_PRODUCTS);
  });
});
