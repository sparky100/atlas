import { describe, expect, it } from 'vitest';
import type { CatalogueEntry } from '../db/productCatalogue';
import { callTool } from './index';
import type { CapabilityCatalogue, ToolContext, ToolResult } from './types';
import { element, estateContext, estateSnapshot, uid } from './fixtures/estateSnapshot';

function ok(result: ToolResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

const entry: CatalogueEntry = {
  id: 'entry-1', code: 'crm-x', product: 'CRM X', vendor: 'Vendor Ltd', summary: 'A CRM.', howItSupports: 'Records complaints.',
  claims: [{ statement: 'Records complaints.', kind: 'functional', sourceUrl: 'https://vendor.example/crm', sourceDate: '2026-01-01', reviewedBy: 'Simon Parkinson', reviewedAt: '2026-01-02' }],
};
const catalogue: CapabilityCatalogue = { sector: 'electricity_network', capabilityCode: '5.4', capabilityName: 'Complaints', catalogueVersion: 2, entries: [entry] };

function context(catalogueForCapability: ToolContext['catalogueForCapability']): ToolContext {
  return { ...estateContext({ snapshot: estateSnapshot({ elements: [element(70, 'capability', 'Complaints', { templateRef: uid(700), code: '5.4' }), element(71, 'capability', 'Hand-made capability')] }) }), ...(catalogueForCapability ? { catalogueForCapability } : {}) };
}

describe('find_catalogue_products', () => {
  it('reads reviewed products for the capability its starter-map item points at, and offers the code for a stale link', async () => {
    let lookup: unknown;
    const result = ok(await callTool(context((capability) => { lookup = capability; return Promise.resolve(catalogue); }), 'find_catalogue_products', { capability_element_id: uid(70) }));
    expect(lookup).toEqual({ templateRef: uid(700), code: '5.4' });
    expect(result.data).toMatchObject({
      capability: { id: uid(70), name: 'Complaints', code: '5.4' },
      catalogue: { sector: 'electricity_network', version: 2 },
      products: [{ entryCode: 'crm-x', product: 'CRM X', vendor: 'Vendor Ltd', claims: [{ statement: 'Records complaints.' }] }],
    });
    expect(result.total).toBe(1);
  });

  it('refuses to guess for a hand-made capability or for an element that is not a capability', async () => {
    const ctx = context(() => Promise.resolve(catalogue));
    expect((await callTool(ctx, 'find_catalogue_products', { capability_element_id: uid(71) }))).toMatchObject({ ok: false, error: expect.stringContaining('not created from a starter map') });
    expect((await callTool(ctx, 'find_catalogue_products', { capability_element_id: uid(10) }))).toMatchObject({ ok: false, error: expect.stringContaining('only reads a capability') });
  });

  it('says plainly when no catalogue is available, instead of naming a product from memory', async () => {
    expect((await callTool(context(undefined), 'find_catalogue_products', { capability_element_id: uid(70) }))).toMatchObject({ ok: false, error: expect.stringContaining('not available to this run') });
    expect((await callTool(context(() => Promise.resolve(null)), 'find_catalogue_products', { capability_element_id: uid(70) }))).toMatchObject({ ok: false, error: expect.stringContaining('No published catalogue') });
  });
});
