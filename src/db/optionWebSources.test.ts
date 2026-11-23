import { describe, expect, it } from 'vitest';
import type { OptionWebSourceRow } from '../contracts/optionSource';
import type { Client } from './client';
import { insertOptionWebSource, optionWebSourcesFromRows } from './optionWebSources';

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
  assertion: null,
  checked_by: null,
  checked_at: null,
};

describe('optionWebSourcesFromRows', () => {
  it('maps the saved page to a web source and keeps the URL as its identity', () => {
    expect(optionWebSourcesFromRows([row])[0]).toEqual({
      kind: 'web', id: 'branch-1\u0000https://vendor.example/evidence', branchId: 'branch-1', optionId: null,
      url: 'https://vendor.example/evidence', title: 'Product evidence', publisher: 'Vendor Ltd',
      excerpt: 'The page says it records complaints.', retrievedAt: '2026-11-21T10:00:00Z',
      citedBy: 'user-1', citedAt: '2026-11-21T10:05:00Z',
      assertion: null, checkedBy: null, checkedAt: null,
    });
  });

  it('allows a page saved without a publisher or excerpt', () => {
    expect(optionWebSourcesFromRows([{ ...row, publisher: null, excerpt: null }])[0]).toMatchObject({ publisher: null, excerpt: null });
  });
});

describe('insertOptionWebSource', () => {
  const capture = (error: unknown = null) => {
    let inserted: Record<string, unknown> | undefined;
    const client = {
      from: () => ({ insert: (value: Record<string, unknown>) => { inserted = value; return Promise.resolve({ error }); } }),
    } as unknown as Client;
    return { client, inserted: () => inserted };
  };

  const candidate = {
    url: 'https://vendor.example/page',
    title: 'A page',
    publisher: '',
    excerpt: null,
    retrievedAt: '2026-11-23T10:00:00Z',
  };

  it('saves the page without claiming anyone checked it', async () => {
    const { client, inserted } = capture();
    await insertOptionWebSource(client, { decisionId: 'decision-1', branchId: 'branch-1', candidate, citedBy: 'user-1' });
    expect(inserted()).toMatchObject({
      decision_id: 'decision-1', branch_id: 'branch-1', url: candidate.url, title: 'A page',
      publisher: null, excerpt: null, retrieved_at: candidate.retrievedAt, cited_by: 'user-1',
      assertion: null, checked_by: null, checked_at: null,
    });
  });

  it('explains a page already saved with the option', async () => {
    const { client } = capture({ code: '23505', message: 'duplicate key' });
    await expect(insertOptionWebSource(client, { decisionId: 'decision-1', branchId: 'branch-1', candidate, citedBy: 'user-1' }))
      .rejects.toThrow('already saved with this option');
  });
});
