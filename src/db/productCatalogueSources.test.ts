import { describe, expect, it } from 'vitest';
import type { OptionCatalogueSourceRow } from '../contracts/productCatalogue';
import { optionSourcesFromRows } from './productCatalogue';

const row: OptionCatalogueSourceRow = {
  decision_id: 'decision-1',
  branch_id: 'branch-1',
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
      kind: 'catalogue', branchId: 'branch-1', product: 'CRM X', vendor: 'Vendor Ltd', standing: 'replaced',
      id: 'branch-1\u0000electricity_network\u00001\u0000crm-x',
    });
    expect(sources[0]?.claims[0]?.statement).toBe('Records complaints.');
  });

  it('never presents a citation with no standing as current', () => {
    expect(optionSourcesFromRows([row], new Map())[0]?.standing).toBe('withdrawn');
  });
});
