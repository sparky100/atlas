/**
 * Suggested platforms, real database: products whose names start the same way
 * are suggested as components of one platform; accepting adds the platform as a
 * draft when it is missing and links the chosen products (the server stamps who
 * and when); rejecting is remembered, stamped, and cannot be forged, edited or
 * deleted from the browser; only a platform admin can read or write either.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { acceptPlatformSuggestion, listPlatformSuggestions, readCatalogueProduct, rejectPlatformSuggestion, saveCatalogueProduct } from './catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
// Letters only: a hex tail such as 3cad reads as a currency code to the no-prices rule.
const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `platform-suggest-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('suggested platforms, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  const ids: string[] = [];
  const vendor = `Suggestvendor ${suffix}`;
  const make = async (code: string, product: string): Promise<string> => {
    const saved = await saveCatalogueProduct(admin.client, null, 0, {
      code: `${code}-${suffix}`, product, vendor, summary: 'Used by the suggested platforms test.', capabilities: [], claims: [],
    });
    ids.push(saved.productId);
    return saved.productId;
  };

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
  });

  afterAll(async () => {
    await service.from('catalogue_products').update({ part_of_product_id: null }).in('id', ids);
    await service.from('catalogue_rejected_platform_pairs').delete().in('product_id', ids);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('suggests a missing platform, adds it as a draft on accept and links the chosen products', async () => {
    const a = await make('a', `Gridsuite ${suffix} Network`);
    const b = await make('b', `Gridsuite ${suffix} Billing`);
    const c = await make('c', `Gridsuite ${suffix} Metering`);
    const found = (await listPlatformSuggestions(admin.client)).find((row) => row.vendor === vendor);
    if (found === undefined) throw new Error('no suggestion for the test vendor');
    expect(found.platformId).toBeNull();
    expect(found.platformName).toBe(`Gridsuite ${suffix}`);
    expect(found.components.map((component) => component.id).sort()).toEqual([a, b, c].sort());

    const result = await acceptPlatformSuggestion(admin.client, found, [a, b]);
    expect(result).toMatchObject({ created: true, linked: 2 });
    ids.push(result.platformId);
    const platform = await readCatalogueProduct(admin.client, result.platformId);
    expect(platform.components.map((component) => component.id).sort()).toEqual([a, b].sort());
    expect(platform.content.claims).toEqual([]);
    expect((await readCatalogueProduct(admin.client, a)).partOf?.id).toBe(result.platformId);
    expect((await readCatalogueProduct(admin.client, c)).partOf).toBeNull();
    // The platform is now in the library: the product left over is still offered, under that platform.
    const after = (await listPlatformSuggestions(admin.client)).find((row) => row.vendor === vendor);
    expect(after?.platformId).toBe(result.platformId);
    expect(after?.components.map((component) => component.id)).toEqual([c]);
  });

  it('remembers a rejection, stamped by the server, and refuses forging, editing and deleting', async () => {
    const vendor2 = `Rejectvendor ${suffix}`;
    const make2 = async (code: string, product: string): Promise<string> => {
      const saved = await saveCatalogueProduct(admin.client, null, 0, { code: `${code}-${suffix}`, product, vendor: vendor2, summary: 'Used by the rejection test.', capabilities: [], claims: [] });
      ids.push(saved.productId);
      return saved.productId;
    };
    const a = await make2('ra', `Modulesuite ${suffix} One`);
    const b = await make2('rb', `Modulesuite ${suffix} Two`);
    const found = (await listPlatformSuggestions(admin.client)).find((row) => row.vendor === vendor2);
    if (found === undefined) throw new Error('no suggestion for the rejection vendor');
    expect(found.components).toHaveLength(2);
    await rejectPlatformSuggestion(admin.client, found.platformKey, [a, b]);
    expect((await listPlatformSuggestions(admin.client)).find((row) => row.vendor === vendor2)).toBeUndefined();
    const stored = await service.from('catalogue_rejected_platform_pairs').select('rejected_by,rejected_by_name').eq('product_id', a).single();
    expect((stored.data as { rejected_by: string }).rejected_by).toBe(admin.id);
    expect((stored.data as { rejected_by_name: string | null }).rejected_by_name).toBeTruthy();
    const forged = await admin.client.from('catalogue_rejected_platform_pairs').insert({ product_id: a, platform_key: 'other-words', rejected_by_name: 'Somebody Else' } as never);
    expect(forged.error).not.toBeNull();
    expect((await admin.client.from('catalogue_rejected_platform_pairs').update({ platform_key: 'x' }).eq('product_id', a).select()).data ?? []).toEqual([]);
    expect((await admin.client.from('catalogue_rejected_platform_pairs').delete().eq('product_id', a).select()).data ?? []).toEqual([]);
  });

  it('refuses a signed-in user who is not a platform admin, and a signed-out one', async () => {
    const some = ids[0] ?? randomUUID();
    expect(((await outside.client.from('catalogue_rejected_platform_pairs').select('product_id')).data ?? []).length).toBe(0);
    const insert = await outside.client.from('catalogue_rejected_platform_pairs').insert({ product_id: some, platform_key: 'x' });
    expect(insert.error).not.toBeNull();
    await expect(listPlatformSuggestions(outside.client).then((rows) => rows.filter((row) => row.vendor.endsWith(suffix)))).resolves.toEqual([]);
    const anon = createSupabaseClient(env);
    expect(((await anon.from('catalogue_rejected_platform_pairs').select('product_id')).data ?? []).length).toBe(0);
  });
});
