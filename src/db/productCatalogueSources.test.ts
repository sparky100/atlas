import { describe, expect, it } from 'vitest';
import type { OptionCatalogueSourceRow } from '../contracts/productCatalogue';
import { citationLabel } from '../contracts/optionSource';
import { citationStandingKey, mergeCatalogueEntries, optionSourcesFromRows, type CitableCatalogueEntry } from './productCatalogue';

const row: OptionCatalogueSourceRow = {
  decision_id: 'decision-1',
  branch_id: 'branch-1',
  option_id: 'option-1',
  catalogue_sector: 'electricity_network',
  catalogue_version: 1,
  entry_code: 'crm-x',
  snapshot: {
    sector: 'electricity_network', version: 1, capabilityMapVersion: 4, catalogueTitle: 'Electricity catalogue',
    licence: 'CC-BY-4.0', entryCode: 'crm-x', product: 'CRM X', vendor: 'Vendor Ltd', summary: 'A CRM.',
    capabilities: [{ code: '5.4', name: 'Complaints', howItSupports: 'Records complaints.' }],
    claims: [{ position: 1, kind: 'functional', statement: 'Records complaints.', sourceUrl: 'https://vendor.example/crm', sourceDate: '2026-01-01', reviewedBy: 'Simon Parkinson', reviewedAt: '2026-01-02' }],
  },
  cited_by: 'user-1',
  cited_at: '2026-11-21T09:00:00Z',
};

describe('optionSourcesFromRows', () => {
  it('reads the saved snapshot, not a live catalogue read, and carries the live standing separately', () => {
    const sources = optionSourcesFromRows([row], new Map([['electricity_network\u00001', 'replaced']]));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: 'catalogue', optionId: 'option-1', branchId: 'branch-1', product: 'CRM X', vendor: 'Vendor Ltd', standing: 'replaced',
      id: 'option-1\u0000electricity_network\u00001\u0000crm-x',
    });
    const first = sources[0];
    if (first?.kind !== 'catalogue') throw new Error('Expected a catalogue source');
    expect(first.claims[0]?.statement).toBe('Records complaints.');
  });

  it('never presents a citation with no standing as current', () => {
    const first = optionSourcesFromRows([row], new Map())[0];
    if (first?.kind !== 'catalogue') throw new Error('Expected a catalogue source');
    expect(first.standing).toBe('withdrawn');
  });
});

describe('citing a product published on its own', () => {
  const productRow: OptionCatalogueSourceRow = {
    ...row, catalogue_sector: 'product', catalogue_version: 3, entry_code: 'crm-y',
    snapshot: { ...row.snapshot, sector: 'product', version: 3, catalogueTitle: 'Product library', licence: 'Atlas product library', entryCode: 'crm-y', product: 'CRM Y', approvedByName: 'Priya', approvedAt: '2026-11-27T09:00:00Z', capabilities: [] },
  };

  it('keys a product citation by its code too, because revision numbers are per product', () => {
    expect(citationStandingKey({ sector: 'product', version: 3, entryCode: 'crm-y' })).not.toBe(citationStandingKey({ sector: 'product', version: 3, entryCode: 'crm-z' }));
    expect(citationStandingKey({ sector: 'electricity_network', version: 1, entryCode: 'crm-x' })).toBe('electricity_network\u00001');
  });

  it('reads the saved revision and its live standing', () => {
    const [source] = optionSourcesFromRows([productRow], new Map([[citationStandingKey({ sector: 'product', version: 3, entryCode: 'crm-y' }), 'replaced']]));
    expect(source).toMatchObject({ kind: 'catalogue', sector: 'product', version: 3, entryCode: 'crm-y', product: 'CRM Y', standing: 'replaced' });
    expect(citationLabel(source as { sector: string; version: number })).toBe('product revision 3');
    expect(citationLabel({ sector: 'electricity_network', version: 1 })).toBe('catalogue v1');
  });

  it('treats a product citation with no readable revision as no longer current', () => {
    expect(optionSourcesFromRows([productRow], new Map())[0]).toMatchObject({ standing: 'withdrawn' });
  });
});

describe('mergeCatalogueEntries', () => {
  const entry = (product: string, vendor: string, citation: { sector: string; version: number }): CitableCatalogueEntry => ({
    id: `${citation.sector}-${product}`, code: product.toLowerCase().replace(/\s+/g, '-'), product, vendor, summary: 's', howItSupports: 'h', claims: [], citation,
  });

  it('lists a product published on its own instead of the same product from a sector catalogue, and keeps the rest', () => {
    const merged = mergeCatalogueEntries(
      [entry('Workday Financials', 'Workday', { sector: 'product', version: 2 })],
      [entry('workday financials', 'WORKDAY ', { sector: 'electricity_network', version: 1 }), entry('Maximo', 'IBM', { sector: 'electricity_network', version: 1 })],
    );
    expect(merged.map((e) => `${e.product}:${e.citation.sector}`)).toEqual(['Maximo:electricity_network', 'Workday Financials:product']);
  });
});
