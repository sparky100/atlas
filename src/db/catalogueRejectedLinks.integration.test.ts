/**
 * Catalogue step 6b, real database: a rejected link proposal is a record that
 * only platform admins can read or add, the server stamps who and when, nobody
 * can edit or delete one from a browser, accepting a proposal is an ordinary
 * edit of the product through the guarded save, and a "find_set" run is
 * recorded like the other runs.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { acceptLinkProposals, finishCheckRun, listCheckRuns, listLinkProposalInputs, readCatalogueProduct, rejectLinkProposals, saveCatalogueProduct, startCheckRun } from './catalogueAdmin';
import type { LinkProposal } from '../tools/catalogueLinkProposals';

const env = loadEnv();
const service = createServiceRoleClient(env);
const suffix = randomUUID().slice(0, 8);
const mapVersion = 950000 + (Number.parseInt(suffix.slice(0, 5), 16) % 40000);

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `rejected-links-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue rejected links and find-for-set runs, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let mapId: string;
  let productId: string;
  const runIds: string[] = [];
  const proposal = (code: string, name: string): LinkProposal => ({ key: `${productId}\u0000${code}`, productId, product: 'Rejected links product', vendor: 'Vendor', code, name, howItSupports: 'It supports the capability.', why: 'test' });

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    mapId = randomUUID();
    check(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: mapVersion, status: 'draft', title: 'Rejected links set', summary: 'Rejected links set', source_description: 'Integration test.' }));
    check(await service.from('capability_map_items').insert([
      { id: randomUUID(), map_id: mapId, code: '31', parent_code: null, name: `Linked capability ${suffix}`, description: 'Definition.', level: 1, item_order: 10 },
      { id: randomUUID(), map_id: mapId, code: '32', parent_code: null, name: `Proposed capability ${suffix}`, description: 'Definition.', level: 1, item_order: 20 },
    ]));
    check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
    productId = (await saveCatalogueProduct(admin.client, null, 0, {
      code: `rejected-links-${suffix}`, product: `Rejected links product ${suffix}`, vendor: 'Rejected links vendor', summary: 'Used by the rejected-links test.',
      capabilities: [{ capabilityMapId: mapId, capabilityCode: '31', capabilityName: `Linked capability ${suffix}`, howItSupports: 'Supports it' }],
      claims: [{ position: 1, kind: 'functional', statement: 'The vendor says this product works.', sourceUrl: 'https://example.test/rejected', sourceDate: '2026-11-27' }],
    })).productId;
  });

  afterAll(async () => {
    await service.from('catalogue_rejected_links').delete().eq('product_id', productId);
    for (const id of runIds) await service.from('catalogue_check_runs').delete().eq('id', id);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('lets an admin reject a proposal, stamps who and when, and shows it in the proposal inputs', async () => {
    await rejectLinkProposals(admin.client, mapId, [proposal('32', `Proposed capability ${suffix}`)], 'Not the same thing');
    // Rejecting the same pair again changes nothing.
    await rejectLinkProposals(admin.client, mapId, [proposal('32', `Proposed capability ${suffix}`)], 'Different words');
    const stored = await service.from('catalogue_rejected_links').select('rejected_by,rejected_by_name,reason').eq('product_id', productId);
    const rows: { rejected_by: string; rejected_by_name: string; reason: string }[] = stored.data ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rejected_by: admin.id, reason: 'Not the same thing' });
    expect(rows[0]?.rejected_by_name).toBeTruthy();
    const inputs = await listLinkProposalInputs(admin.client);
    expect(inputs.rejected.some((row) => row.productId === productId && row.code === '32')).toBe(true);
    expect(inputs.links.some((row) => row.productId === productId && row.code === '31')).toBe(true);
    await expect(rejectLinkProposals(admin.client, mapId, [proposal('32', 'x')], '   ')).rejects.toThrow();
  });

  it('refuses a forged name or time, an edit, a delete, and a signed-in user who is not a platform admin', async () => {
    const forged = await admin.client.from('catalogue_rejected_links').insert({ product_id: productId, capability_map_id: mapId, capability_code: '33', capability_name: 'Other', reason: 'x', rejected_by_name: 'Somebody Else' });
    expect(forged.error).not.toBeNull();
    const edit = await admin.client.from('catalogue_rejected_links').update({ reason: 'changed' }).eq('product_id', productId).select();
    expect(edit.error !== null || ((edit.data as unknown[] | null) ?? []).length === 0).toBe(true);
    const remove = await admin.client.from('catalogue_rejected_links').delete().eq('product_id', productId).select();
    expect(remove.error !== null || ((remove.data as unknown[] | null) ?? []).length === 0).toBe(true);
    await expect(rejectLinkProposals(outside.client, mapId, [proposal('34', 'Nope')], 'Not allowed')).rejects.toThrow();
    const seen = await outside.client.from('catalogue_rejected_links').select('id').eq('product_id', productId);
    expect(((seen.data as unknown[] | null) ?? []).length).toBe(0);
    const anon = createSupabaseClient(env);
    expect(((await anon.from('catalogue_rejected_links').select('id')).data as unknown[] | null ?? []).length).toBe(0);
    const stillThere = await service.from('catalogue_rejected_links').select('reason').eq('product_id', productId);
    expect((stillThere.data as { reason: string }[]).map((row) => row.reason)).toEqual(['Not the same thing']);
  });

  it('accepts a proposal as an ordinary edit through the guarded save, leaving the claims as they were', async () => {
    const before = await readCatalogueProduct(admin.client, productId);
    const result = await acceptLinkProposals(admin.client, mapId, [proposal('32', `Proposed capability ${suffix}`)]);
    expect(result.failed).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    const after = await readCatalogueProduct(admin.client, productId);
    expect(after.content.capabilities.map((link) => link.capabilityCode).sort()).toEqual(['31', '32']);
    expect(after.product.edit_revision).toBe(before.product.edit_revision + 1);
    expect(after.claimReviews[0]?.reviewState).toBe(before.claimReviews[0]?.reviewState);
    const denied = await acceptLinkProposals(outside.client, mapId, [proposal('32', 'x')]);
    expect(denied.accepted).toEqual([]);
    expect(denied.failed).toHaveLength(1);
  });

  it('records a find_set run with its counters, and refuses an unknown scope', async () => {
    const id = await startCheckRun(admin.client, 'find_set');
    runIds.push(id);
    await finishCheckRun(admin.client, id, { status: 'finished', linksChecked: 0, claimsChecked: 0, flagged: 0, searches: 7, productsFound: 5, tokens: { input: 9000, output: 1200 }, note: 'Searched 3 capabilities.' });
    const run = (await listCheckRuns(admin.client, 20)).find((candidate) => candidate.id === id);
    expect(run).toMatchObject({ kind: 'manual', scope: 'find_set', status: 'finished', searches: 7, productsFound: 5, tokens: 10200 });
    expect((await admin.client.from('catalogue_check_runs').insert({ kind: 'manual', scope: 'other' })).error).not.toBeNull();
  });
});
