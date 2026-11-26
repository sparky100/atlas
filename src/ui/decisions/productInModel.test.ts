import { describe, expect, it } from 'vitest';
import { findProductInModel, productInModelText, type ModelElementName } from './productInModel';

const el = (id: number, name: string, type: 'system' | 'container' = 'system', platformName: string | null = null): ModelElementName => ({ id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, name, type, platformName });

describe('findProductInModel', () => {
  const utilityNetwork = el(1, 'Utility Network', 'container', 'Esri ArcGIS Platform');
  const smallworld = el(2, 'Smallworld GIS');

  it('finds the module whose whole name is inside the product name', () => {
    expect(findProductInModel('Esri ArcGIS Utility Network', [smallworld, utilityNetwork])).toBe(utilityNetwork);
  });

  it('ignores case and punctuation', () => {
    expect(findProductInModel('ESRI ArcGIS: Utility-Network', [utilityNetwork])).toBe(utilityNetwork);
  });

  it('needs the whole name, in order, as whole words', () => {
    expect(findProductInModel('Network Utility Suite', [utilityNetwork])).toBeNull();
    expect(findProductInModel('Utilitynetworks Cloud', [utilityNetwork])).toBeNull();
    expect(findProductInModel('Esri ArcGIS Pro', [utilityNetwork, smallworld])).toBeNull();
  });

  it('never matches a short generic name', () => {
    expect(findProductInModel('Esri ArcGIS GIS Cloud', [el(3, 'GIS')])).toBeNull();
  });

  it('prefers the longest matching name', () => {
    const arcgis = el(4, 'Esri ArcGIS Utility');
    expect(findProductInModel('Esri ArcGIS Utility Network', [arcgis, utilityNetwork])).toBe(arcgis);
    const platform = el(5, 'Esri ArcGIS Utility Network');
    expect(findProductInModel('Esri ArcGIS Utility Network', [arcgis, platform])).toBe(platform);
  });

  it('says a module is a module of its platform', () => {
    expect(productInModelText(utilityNetwork)).toBe('Utility Network, a module of Esri ArcGIS Platform');
    expect(productInModelText(smallworld)).toBe('Smallworld GIS');
  });
});
