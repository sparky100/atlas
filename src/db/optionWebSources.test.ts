import { describe, expect, it } from 'vitest';
import type { OptionWebSourceRow } from '../contracts/optionSource';
import { optionWebSourcesFromRows } from './optionWebSources';

const row: OptionWebSourceRow = {
  decision_id: 'decision-1',
  branch_id: 'branch-1',
  url: 'https://vendor.example/evidence',
  title: 'Product evidence',
  publisher: 'Vendor Ltd',
  excerpt: 'The page says it records complaints.',
  retrieved_at: '2026-11-21T10:00:00Z',
  cited_by: 'user-1',
  cited_at: '2026-11-21T10:05:00Z',
};

describe('optionWebSourcesFromRows', () => {
  it('maps the saved page to a web source and keeps the URL as its identity', () => {
    expect(optionWebSourcesFromRows([row])[0]).toEqual({
      kind: 'web', id: 'branch-1\u0000https://vendor.example/evidence', branchId: 'branch-1',
      url: 'https://vendor.example/evidence', title: 'Product evidence', publisher: 'Vendor Ltd',
      excerpt: 'The page says it records complaints.', retrievedAt: '2026-11-21T10:00:00Z',
      citedBy: 'user-1', citedAt: '2026-11-21T10:05:00Z',
    });
  });

  it('allows a page saved without a publisher or excerpt', () => {
    expect(optionWebSourcesFromRows([{ ...row, publisher: null, excerpt: null }])[0]).toMatchObject({ publisher: null, excerpt: null });
  });
});
