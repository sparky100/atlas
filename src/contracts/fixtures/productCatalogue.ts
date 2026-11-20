/** Test-only reviewed content. Never imported by an application path. */
import type { ProductCatalogueContent } from '../productCatalogue';
export const catalogueFixture: ProductCatalogueContent = {
  sector: 'electricity_network', version: 1, capabilityMapVersion: 4, status: 'draft',
  title: 'Electricity network products', sourceDescription: 'Test fixture, not published product advice.', licence: 'CC-BY-4.0',
  entries: [{ code: 'quote-tool', product: 'Quotation Tool', vendor: 'Example Vendor', summary: 'Manages connection quotations.',
    capabilities: [{ code: '11.1', name: 'Connection Quotations', howItSupports: 'Prepares and tracks quotations.' }],
    claims: [{ position: 1, kind: 'functional', statement: 'Tracks connection quotations.', sourceUrl: 'https://example.com/quotations',
      sourceDate: '2026-11-12', reviewedBy: 'Test Reviewer', reviewedAt: '2026-11-20' }],
  }],
};
