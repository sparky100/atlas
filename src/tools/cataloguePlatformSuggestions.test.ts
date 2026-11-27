import { describe, expect, it } from 'vitest';
import { suggestPlatforms, type SuggestionProduct } from './cataloguePlatformSuggestions';

const p = (id: string, vendor: string, product: string, extra: Partial<SuggestionProduct> = {}): SuggestionProduct => ({ id, vendor, product, partOfProductId: null, componentCount: 0, ...extra });

describe('suggested platforms', () => {
  it('groups products that start the same way and names the platform with the vendor', () => {
    const out = suggestPlatforms([
      p('1', 'Oracle', 'Oracle Utilities Customer Care and Billing'),
      p('2', 'Oracle', 'Oracle Utilities Meter Data Management'),
      p('3', 'Oracle', 'Oracle Utilities Customer Cloud Service'),
      p('4', 'Oracle', 'Oracle Fusion Cloud Financial Management'),
    ], new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ platformName: 'Oracle Utilities', platformKey: 'utilities', platformId: null });
    expect(out[0]?.components.map((c) => c.id).sort()).toEqual(['1', '2', '3']);
  });
  it('uses the product that already is the platform, and leaves it out of the components', () => {
    const out = suggestPlatforms([
      p('1', 'Esri', 'ArcGIS'),
      p('2', 'Esri', 'ArcGIS Utility Network'),
      p('3', 'Esri', 'ArcGIS Law Enforcement'),
    ], new Set());
    expect(out[0]).toMatchObject({ platformId: '1', platformName: 'ArcGIS' });
    expect(out[0]?.components.map((c) => c.id).sort()).toEqual(['2', '3']);
  });
  it('does not offer a product that is already a component, or a product that is a platform', () => {
    expect(suggestPlatforms([
      p('1', 'Microsoft', 'Microsoft Dynamics 365 Customer Service', { partOfProductId: 'x' }),
      p('2', 'Microsoft', 'Microsoft Dynamics 365 Field Service'),
    ], new Set())).toEqual([]);
    expect(suggestPlatforms([
      p('1', 'System C', 'CareFlow EPR'),
      p('2', 'System C', 'CareFlow Medicines Management', { componentCount: 2 }),
    ], new Set())).toEqual([]);
  });
  it('remembers a rejection and does not pair products across vendors or with one shared word only', () => {
    const products = [p('1', 'Civica', 'Civica Cx Housing'), p('2', 'Civica', 'Civica Cx Asset Management'), p('3', 'Other', 'Cx Housing')];
    expect(suggestPlatforms(products, new Set())[0]).toMatchObject({ platformName: 'Civica Cx', platformKey: 'cx' });
    expect(suggestPlatforms(products, new Set(['1|cx']))).toEqual([]);
    expect(suggestPlatforms([p('1', 'Microsoft', 'Microsoft Project'), p('2', 'Microsoft', 'Power BI')], new Set())).toEqual([]);
  });
  it('treats the same product under two names as a duplicate, not as two components', () => {
    expect(suggestPlatforms([p('1', 'Esri', 'ArcGIS Utility Network'), p('2', 'Esri', 'Esri ArcGIS Utility Network')], new Set())).toEqual([]);
  });
});
