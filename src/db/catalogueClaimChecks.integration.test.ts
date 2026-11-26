/**
 * Catalogue step 5b-1, real database: claim-check results are readable and
 * writable by platform admins only, the server stamps who and when, "supported"
 * needs a quote, a person's "I looked" is stamped by the server and cannot
 * change the AI's result, and a new check clears it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { dismissClaimCheck, listClaimChecks, listClaimsForCheck, saveCatalogueProduct, saveClaimChecks } from './catalogueAdmin';
import type { CatalogueProductContent } from '../contracts/catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
const suffix = randomUUID().slice(0, 8);
const mapVersion = 830000 + (Number.parseInt(suffix.slice(0, 5), 16) % 60000);
const urlA = `https://example.test/claim-a-${suffix}`;
const urlB = `https://example.test/claim-b-${suffix}`;
const statementA = 'The vendor describes this as a changed page.';
const statementB = 'The vendor describes this as a supported page.';

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `claim-check-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue claim checks, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let productId: string;

  const result = (statement: string, sourceUrl: string, verdict: 'supported' | 'changed' | 'cant_tell', quote: string | null) =>
    ({ productId, sourceUrl, statement, verdict, quote, note: null, model: 'test-model', inputTokens: 900, outputTokens: 40 });

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    const mapId = randomUUID();
    check(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: mapVersion, status: 'draft', title: 'Claim check set', summary: 'Claim check set', source_description: 'Integration test.' }));
    check(await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: 'Claim check capability', description: 'Definition.', level: 1, item_order: 10 }));
    check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
    const content: CatalogueProductContent = {
      code: `claim-check-${suffix}`, product: `Claim check product ${suffix}`, vendor: 'Claim check vendor', summary: 'A product used by the claim-check integration test.',
      capabilities: [{ capabilityMapId: mapId, capabilityCode: '1', capabilityName: 'Claim check capability', howItSupports: 'Supports it' }],
      claims: [
        { position: 1, kind: 'functional', statement: statementA, sourceUrl: urlA, sourceDate: '2026-11-21' },
        { position: 2, kind: 'deployment', statement: statementB, sourceUrl: urlB, sourceDate: '2026-11-21' },
      ],
    };
    productId = (await saveCatalogueProduct(admin.client, null, 0, content)).productId;
  });

  afterAll(async () => {
    await service.from('catalogue_claim_checks').delete().eq('product_id', productId);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('lists the product claims for checking, with their product', async () => {
    const claims = (await listClaimsForCheck(admin.client)).filter((claim) => claim.productId === productId);
    expect(claims.map((claim) => claim.statement).sort()).toEqual([statementA, statementB].sort());
    expect(claims[0]).toMatchObject({ product: `Claim check product ${suffix}`, vendor: 'Claim check vendor' });
  });

  it('lets an admin save checks, stamps who and when, and refuses "supported" without a quote', async () => {
    await saveClaimChecks(admin.client, [
      result(statementA, urlA, 'changed', 'The page now says something else entirely.'),
      result(statementB, urlB, 'supported', 'The page says this is a supported page.'),
    ]);
    const saved = (await listClaimChecks(admin.client)).filter((row) => row.productId === productId);
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.checkedByName !== null && row.checkedByName !== '' && row.model === 'test-model')).toBe(true);
    const stored = await service.from('catalogue_claim_checks').select('checked_by').eq('product_id', productId).eq('source_url', urlA).single();
    expect((stored.data as { checked_by: string }).checked_by).toBe(admin.id);

    await expect(saveClaimChecks(admin.client, [result(statementB, urlB, 'supported', null)])).rejects.toThrow();

    // A forged person or time in the request is overwritten by the server.
    check(await admin.client.from('catalogue_claim_checks').upsert({
      product_id: productId, source_url: urlA, statement: statementA, verdict: 'changed', quote: 'The page now says something else entirely.',
      checked_by: outside.id, checked_by_name: 'Somebody Else', checked_at: '2000-01-01T00:00:00Z',
    }, { onConflict: 'product_id,source_url,statement' }));
    const after = await service.from('catalogue_claim_checks').select('checked_by,checked_by_name,checked_at').eq('product_id', productId).eq('source_url', urlA).single();
    const row = after.data as { checked_by: string; checked_by_name: string; checked_at: string };
    expect(row.checked_by).toBe(admin.id);
    expect(row.checked_by_name).not.toBe('Somebody Else');
    expect(new Date(row.checked_at).getFullYear()).toBeGreaterThan(2000);
  });

  it('records "I looked" with the server\'s name and time, cannot alter the AI result, and a new check clears it', async () => {
    await dismissClaimCheck(admin.client, { productId, sourceUrl: urlA, statement: statementA });
    let row = (await listClaimChecks(admin.client)).find((candidate) => candidate.productId === productId && candidate.sourceUrl === urlA);
    expect(row?.dismissedAt).not.toBeNull();
    expect(row?.dismissedByName).toBeTruthy();
    await expect(dismissClaimCheck(admin.client, { productId, sourceUrl: urlA, statement: statementA })).rejects.toThrow();

    // Dismissing while also trying to rewrite the verdict, the person and the time changes none of those.
    check(await admin.client.from('catalogue_claim_checks').update({ verdict: 'cant_tell', quote: null, dismissed_at: '2000-01-01T00:00:00Z', dismissed_by_name: 'Somebody Else' }).eq('product_id', productId).eq('source_url', urlB).eq('statement', statementB));
    row = (await listClaimChecks(admin.client)).find((candidate) => candidate.productId === productId && candidate.sourceUrl === urlA);
    expect(row?.verdict).toBe('changed');
    const dismissedB = (await listClaimChecks(admin.client)).find((candidate) => candidate.productId === productId && candidate.sourceUrl === urlB);
    expect(dismissedB?.verdict).toBe('supported');
    expect(dismissedB?.dismissedByName).not.toBe('Somebody Else');
    expect(new Date(dismissedB?.dismissedAt ?? '2000-01-01').getFullYear()).toBeGreaterThan(2000);

    // A new check of the same claim replaces the result and clears the earlier "I looked".
    await saveClaimChecks(admin.client, [result(statementA, urlA, 'changed', 'The page now says something else entirely.')]);
    row = (await listClaimChecks(admin.client)).find((candidate) => candidate.productId === productId && candidate.sourceUrl === urlA);
    expect(row?.dismissedAt).toBeNull();
  });

  it('shows and accepts nothing from a signed-in user who is not a platform admin, or from a signed-out caller', async () => {
    expect((await listClaimChecks(outside.client)).filter((row) => row.productId === productId)).toEqual([]);
    await expect(saveClaimChecks(outside.client, [result(statementA, `${urlA}-x`, 'cant_tell', null)])).rejects.toThrow();
    const update = await outside.client.from('catalogue_claim_checks').update({ dismissed_at: new Date().toISOString() }).eq('product_id', productId).select();
    expect((update.data as unknown[] | null) ?? []).toEqual([]);
    const remove = await outside.client.from('catalogue_claim_checks').delete().eq('product_id', productId).select();
    expect((remove.data as unknown[] | null) ?? []).toEqual([]);
    const still = await service.from('catalogue_claim_checks').select('verdict').eq('product_id', productId);
    expect(((still.data as unknown[] | null) ?? []).length).toBe(2);

    const anon = createSupabaseClient(env);
    const read = await anon.from('catalogue_claim_checks').select('product_id');
    expect(read.error !== null || ((read.data as unknown[] | null) ?? []).length === 0).toBe(true);
    const write = await anon.from('catalogue_claim_checks').insert({ product_id: productId, source_url: urlA, statement: statementA, verdict: 'cant_tell' });
    expect(write.error).not.toBeNull();
  });
});
