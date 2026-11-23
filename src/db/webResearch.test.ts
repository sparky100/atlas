import { describe, expect, it } from 'vitest';
import type { Client } from './client';
import { listEarlierResearchUrls } from './webResearch';

function client(data: unknown, error: unknown = null): Client {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data, error }),
          }),
        }),
      }),
    }),
  } as unknown as Client;
}

describe('listEarlierResearchUrls', () => {
  it('flattens the returned URLs, deduplicates them and keeps only public HTTPS pages', async () => {
    const rows = [
      { urls: ['https://vendor.example/a', 'https://vendor.example/b'] },
      { urls: ['https://vendor.example/a', 'http://insecure.example/c', 42] },
      { urls: 'not an array' },
    ];
    await expect(listEarlierResearchUrls(client(rows), 'decision-1')).resolves.toEqual([
      'https://vendor.example/a',
      'https://vendor.example/b',
    ]);
  });

  it('returns nothing when the record has no searches or cannot be read into the expected shape', async () => {
    await expect(listEarlierResearchUrls(client(null), 'decision-1')).resolves.toEqual([]);
  });

  it('says when the egress record cannot be read', async () => {
    await expect(listEarlierResearchUrls(client(null, { message: 'denied' }), 'decision-1')).rejects.toThrow('listEarlierResearchUrls: denied');
  });
});
