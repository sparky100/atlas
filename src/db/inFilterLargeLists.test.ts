import { describe, expect, it } from 'vitest';
import type { Client } from './client';
import { listCatalogueEntries } from './catalogueAdmin';
import { listDecisionsLinkingElements } from './decisions';
import { MAX_IN_FILTER_VALUES } from './inFilterLimit';
import { listModelsSharedWithOrg } from './modelShares';
import { catalogueStandingByCitation, listCurrentCatalogueEntriesForCapability, templateSectorsForModel } from './productCatalogue';

/**
 * Build rule 8, end to end for the database functions that take an id list
 * from a catalogue or a set of shares: with a list far over the limit, no
 * request may carry more than MAX_IN_FILTER_VALUES values, and every row must
 * still come back. The client here is a recording stub: it answers by table
 * and by the ids it was asked for.
 */
interface Call {
  table: string;
  inColumn?: string;
  inValues?: string[];
}

function stubClient(answer: (call: Call) => unknown[] | Record<string, unknown> | null): { client: Client; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'is', 'not', 'order', 'limit']) builder[name] = () => builder;
      builder.in = (column: string, values: string[]) => {
        call.inColumn = column;
        call.inValues = values;
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve({ data: answer(call), error: null });
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: answer(call), error: null }).then(resolve, reject);
      return builder;
    },
  } as unknown as Client;
  return { client, calls };
}

const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i)}`);
const BIG = 3 * MAX_IN_FILTER_VALUES + 20;

function largestIn(calls: readonly Call[], table: string): number {
  const sizes = calls.filter((c) => c.table === table && c.inValues).map((c) => (c.inValues ?? []).length);
  expect(sizes.length, `${table} was queried with .in()`).toBeGreaterThan(0);
  return Math.max(...sizes);
}

describe('id lists over the .in() limit (build rule 8)', () => {
  it('listCatalogueEntries: entry links and claims for a large catalogue', async () => {
    const entryIds = many(BIG, 'e');
    const { client, calls } = stubClient((call) => {
      if (call.table === 'catalogue_entries') return entryIds.map((id) => ({ id, code: id, product: id, vendor: 'v', summary: 's' }));
      if (call.table === 'catalogue_entry_capabilities') return (call.inValues ?? []).map((id) => ({ entry_id: id, capability_code: 'c', capability_name: 'C', how_it_supports: 'h' }));
      return (call.inValues ?? []).map((id) => ({ entry_id: id, position: 0, kind: 'k', statement: 's', source_url: 'u', source_date: 'd', reviewed_by: 'r', reviewed_at: 'a' }));
    });
    const entries = await listCatalogueEntries(client, 'cat');
    expect(entries).toHaveLength(BIG);
    expect(entries.every((e) => e.capabilities.length === 1 && e.claims.length === 1)).toBe(true);
    expect(largestIn(calls, 'catalogue_entry_capabilities')).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
    expect(largestIn(calls, 'catalogue_claims')).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
  });

  it('catalogueStandingByCitation: many cited sectors', async () => {
    const sectors = many(BIG, 's');
    const { client, calls } = stubClient((call) => (call.inValues ?? []).map((sector) => ({ sector, version: 1, status: 'published', withdrawn_at: null })));
    const standing = await catalogueStandingByCitation(client, sectors.map((sector) => ({ sector, version: 1 })));
    expect(standing.size).toBe(BIG);
    expect([...standing.values()].every((v) => v === 'current')).toBe(true);
    expect(largestIn(calls, 'product_catalogues')).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
  });

  it('templateSectorsForModel: a model seeded from many maps', async () => {
    const mapIds = many(BIG, 'm');
    const { client, calls } = stubClient((call) => (call.table === 'sources' ? mapIds.map((id) => ({ capability_map_id: id })) : (call.inValues ?? []).map((id) => ({ sector: `sector-${id}` }))));
    const sectors = await templateSectorsForModel(client, 'model');
    expect(sectors).toHaveLength(BIG);
    expect(largestIn(calls, 'capability_maps')).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
  });

  it('listCurrentCatalogueEntriesForCapability: a capability many products support', async () => {
    const entryIds = many(BIG, 'e');
    const { client, calls } = stubClient((call) => {
      if (call.table === 'product_catalogues') return { id: 'cat', sector: 'x', version: 1 };
      if (call.table === 'catalogue_entry_capabilities') return entryIds.map((entry_id) => ({ entry_id, how_it_supports: 'h' }));
      if (call.table === 'catalogue_entries') return (call.inValues ?? []).map((id) => ({ id, code: id, product: id, vendor: 'v', summary: 's' }));
      return (call.inValues ?? []).map((entry_id) => ({ entry_id, statement: 's', kind: 'k', source_url: 'u', source_date: 'd', reviewed_by: 'r', reviewed_at: 'a', position: 0 }));
    });
    const entries = await listCurrentCatalogueEntriesForCapability(client, { sector: 'x', capabilityCode: 'c' });
    expect(entries).toHaveLength(BIG);
    expect(entries.every((e) => e.claims.length === 1)).toBe(true);
    expect(largestIn(calls, 'catalogue_entries')).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
    expect(largestIn(calls, 'catalogue_claims')).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
  });

  it('listModelsSharedWithOrg: a model shared many times', async () => {
    const modelIds = many(BIG, 'model');
    const { client, calls } = stubClient((call) => {
      if (call.table === 'model_shares') return modelIds.map((model_id, i) => ({ id: `share-${String(i)}`, model_id, tag_id: `tag-${String(i)}`, shared_with_org_id: 'me', created_at: '2026-01-01' }));
      if (call.table === 'models') return (call.inValues ?? []).map((id) => ({ id, org_id: `org-${id}`, name: id, slug: id }));
      if (call.table === 'organisations') return (call.inValues ?? []).map((id) => ({ id, name: id, slug: id }));
      return (call.inValues ?? []).map((id) => ({ id, name: id }));
    });
    const shared = await listModelsSharedWithOrg(client, 'me');
    expect(shared).toHaveLength(BIG);
    expect(shared.every((s) => s.tagName !== null)).toBe(true);
    for (const table of ['models', 'organisations', 'tags']) expect(largestIn(calls, table)).toBeLessThanOrEqual(MAX_IN_FILTER_VALUES);
  });

  it('listDecisionsLinkingElements: refuses a list over the limit instead of sending a long URL', async () => {
    const { client, calls } = stubClient(() => []);
    await expect(listDecisionsLinkingElements(client, many(MAX_IN_FILTER_VALUES + 1, 'el'))).rejects.toThrow(/listDecisionsLinkingElements/);
    expect(calls).toHaveLength(0);
  });
});
