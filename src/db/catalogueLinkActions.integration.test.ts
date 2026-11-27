/**
 * Catalogue results presentation, real database: a flagged link can be kept for a
 * while (the server stamps who and when, and a different result lifts it), a
 * product can be merged into another (only platform admins, the server stamps
 * who and when, nobody can merge into a merged product), the merged product
 * leaves the lists but still counts as in the library, and a merge can be undone.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { keepSourceLink, listCatalogueProducts, listLibraryProductKeys, listProductMerges, listSourceChecks, mergeProducts, readCatalogueProduct, saveCatalogueProduct, saveSourceChecks, undoProductMerge, unkeepSourceLink } from './catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
// Letters only: a hex tail such as 3cad reads as a currency code to the no-prices rule.
const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `link-actions-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue kept links and merged products, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let keptId = '';
  let mergedId = '';
  const url = `https://example.test/kept-${suffix}`;
  const claim = (statement: string, sourceUrl: string) => ({ position: 1, kind: 'functional' as const, statement, sourceUrl, sourceDate: '2026-11-27' });
  const content = (code: string, product: string, statement: string, sourceUrl: string) => ({ code: `${code}-${suffix}`, product, vendor: `Mergevendor ${suffix}`, summary: 'Used by the merge test.', capabilities: [], claims: [claim(statement, sourceUrl)] });

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    keptId = (await saveCatalogueProduct(admin.client, null, 0, content('merge-kept', `Keeper ${suffix}`, 'The vendor describes the kept product.', 'https://example.test/kept-claim'))).productId;
    mergedId = (await saveCatalogueProduct(admin.client, null, 0, content('merge-other', `Mergevendor ${suffix} Keeper ${suffix}`, 'The vendor describes the other copy.', 'https://example.test/other-claim'))).productId;
  });

  afterAll(async () => {
    await service.from('catalogue_product_merges').delete().in('merged_product_id', [mergedId]);
    await service.from('catalogue_source_checks').delete().eq('url', url);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('keeps a link out of the list with who and when stamped, ignores a forged name, and lifts the hide when the result changes', async () => {
    await saveSourceChecks(admin.client, [{ url, result: 'moved', httpStatus: 200, finalUrl: `${url}/new`, note: null }]);
    await keepSourceLink(admin.client, url, 90, 'Still the right page.');
    let row = (await listSourceChecks(admin.client)).find((candidate) => candidate.url === url);
    expect(row?.hiddenUntil).not.toBeNull();
    expect(row?.hiddenReason).toBe('Still the right page.');
    expect(row?.hiddenByName).toBeTruthy();
    const stored = await service.from('catalogue_source_checks').select('hidden_by').eq('url', url).single();
    expect((stored.data as { hidden_by: string }).hidden_by).toBe(admin.id);

    const forged = await admin.client.from('catalogue_source_checks').update({ hidden_by_name: 'Somebody Else' }).eq('url', url).select('hidden_by_name');
    expect(forged.error).toBeNull();
    row = (await listSourceChecks(admin.client)).find((candidate) => candidate.url === url);
    expect(row?.hiddenByName).not.toBe('Somebody Else');

    // Checking the same link again with the same result keeps the hide; a different result lifts it.
    await saveSourceChecks(admin.client, [{ url, result: 'moved', httpStatus: 200, finalUrl: `${url}/new`, note: null }]);
    expect((await listSourceChecks(admin.client)).find((candidate) => candidate.url === url)?.hiddenUntil).not.toBeNull();
    await saveSourceChecks(admin.client, [{ url, result: 'gone', httpStatus: 404, finalUrl: null, note: null }]);
    expect((await listSourceChecks(admin.client)).find((candidate) => candidate.url === url)?.hiddenUntil).toBeNull();

    await keepSourceLink(admin.client, url, 30, 'Leaving it.');
    await unkeepSourceLink(admin.client, url);
    row = (await listSourceChecks(admin.client)).find((candidate) => candidate.url === url);
    expect(row?.hiddenUntil).toBeNull();
    expect(row?.hiddenByName).toBeNull();
  });

  it('refuses a signed-in user who is not a platform admin, for keeping a link and for a merge', async () => {
    await saveSourceChecks(admin.client, [{ url, result: 'moved', httpStatus: 200, finalUrl: `${url}/new`, note: null }]);
    const keep = await outside.client.from('catalogue_source_checks').update({ hidden_until: new Date(Date.now() + 86_400_000).toISOString(), hidden_reason: 'x' }).eq('url', url).select();
    expect(keep.data ?? []).toEqual([]);
    const merge = await outside.client.from('catalogue_product_merges').insert({ merged_product_id: mergedId, kept_product_id: keptId });
    expect(merge.error).not.toBeNull();
    expect(((await outside.client.from('catalogue_product_merges').select('merged_product_id')).data ?? []).length).toBe(0);
    const anon = createSupabaseClient(env);
    expect(((await anon.from('catalogue_product_merges').select('merged_product_id')).data ?? []).length).toBe(0);
    await expect(mergeProducts(outside.client, keptId, mergedId, 'Not allowed')).rejects.toThrow();
  });

  it('merges one product into another: the kept product gains the claim, the merge is stamped, the merged product leaves the lists but still counts as in the library', async () => {
    const result = await mergeProducts(admin.client, keptId, mergedId, 'Same product under two names.');
    expect(result.addedClaims).toBe(1);
    const kept = await readCatalogueProduct(admin.client, keptId);
    expect(kept.content.claims.map((item) => item.statement).sort()).toEqual(['The vendor describes the kept product.', 'The vendor describes the other copy.']);
    expect(kept.claimReviews.every((review) => review.reviewState === 'drafted')).toBe(true);
    const merges = (await listProductMerges(admin.client)).filter((row) => row.mergedProductId === mergedId);
    expect(merges).toHaveLength(1);
    expect(merges[0]?.keptProductId).toBe(keptId);
    expect(merges[0]?.mergedByName).toBeTruthy();
    const ids = (await listCatalogueProducts(admin.client)).map((product) => product.id);
    expect(ids).toContain(keptId);
    expect(ids).not.toContain(mergedId);
    const keys = await listLibraryProductKeys(admin.client);
    const other = keys.find((row) => row.product === `Mergevendor ${suffix} Keeper ${suffix}`);
    expect(other?.id).toBe(keptId);
  });

  it('refuses a forged name, a second merge into a merged product, a merge of a kept product, and a merge of a product into itself', async () => {
    const forged = await admin.client.from('catalogue_product_merges').insert({ merged_product_id: keptId, kept_product_id: mergedId, merged_by_name: 'Somebody Else' });
    expect(forged.error).not.toBeNull();
    await expect(mergeProducts(admin.client, mergedId, keptId, 'Backwards')).rejects.toThrow();
    await expect(mergeProducts(admin.client, keptId, keptId, 'Itself')).rejects.toThrow();
    const edit = await admin.client.from('catalogue_product_merges').update({ reason: 'changed' }).eq('merged_product_id', mergedId).select();
    expect(edit.error !== null || ((edit.data as unknown[] | null) ?? []).length === 0).toBe(true);
  });

  it('undoes a merge: the product is back in the lists and what was added stays', async () => {
    await undoProductMerge(admin.client, mergedId);
    expect((await listCatalogueProducts(admin.client)).map((product) => product.id)).toContain(mergedId);
    expect((await readCatalogueProduct(admin.client, keptId)).content.claims).toHaveLength(2);
  });
});
