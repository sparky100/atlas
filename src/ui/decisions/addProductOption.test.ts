import { describe, expect, it } from 'vitest';
import { hasProductOption, productOptionTitle } from './addProductOption';

describe('a listed product as an option', () => {
  it('uses the same "Use <product>" title as the Designer and research', () => {
    expect(productOptionTitle({ product: ' Esri ArcGIS Utility Network ' })).toBe('Use Esri ArcGIS Utility Network');
  });

  it('knows when the product is already an option, ignoring case and spaces', () => {
    const product = { product: 'Utility Network' };
    expect(hasProductOption(product, ['Keep Smallworld', ' use utility network '])).toBe(true);
    expect(hasProductOption(product, ['Keep Smallworld'])).toBe(false);
  });
});
