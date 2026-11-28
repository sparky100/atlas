/**
 * Platforms and components, real database: a product can be saved as part of
 * another, only one level deep and never of itself; a save that does not mention
 * "part of" keeps it; a platform lists its components and can be published with
 * no links of its own; and only a platform admin can set it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { listCatalogueProducts, readCatalogueProduct, saveCatalogueProduct } from './catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
// Letters only: a hex tail such as 3cad reads as a currency code to the no-prices rule.
const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `components-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue platforms and components, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  const ids: string[] = [];
  const content = (code: string, product: string, extra: Record<string, unknown> = {}) => ({
    code: `${code}-${suffix}`, product: `${product} ${suffix}`, vendor: `Platformvendor ${suffix}`, summary: 'Used by the platform test.',
    capabilities: [], claims: [{ position: 1, kind: 'functional' as const, statement: 'The vendor describes it.', sourceUrl: 'https://example.test/platform', sourceDate: '2026-11-27' }],
    ...extra,
  });

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
  });

  afterAll(async () => {
    await service.from('catalogue_products').update({ part_of_product_id: null }).in('id', ids);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('saves a component under a platform, lists it on both, and keeps it when a later save does not mention it', async () => {
    const platform = (await saveCatalogueProduct(admin.client, null, 0, content('plat', 'Platform'))).productId;
    const part = (await saveCatalogueProduct(admin.client, null, 0, content('part', 'Platform Module', { partOfProductId: platform }))).productId;
    ids.push(platform, part);
    const detail = await readCatalogueProduct(admin.client, platform);
    expect(detail.components.map((component) => component.id)).toEqual([part]);
    const component = await readCatalogueProduct(admin.client, part);
    expect(component.partOf?.id).toBe(platform);
    await saveCatalogueProduct(admin.client, part, component.product.edit_revision, { ...component.content, partOfProductId: undefined, summary: 'Edited without naming the platform.' });
    expect((await readCatalogueProduct(admin.client, part)).partOf?.id).toBe(platform);
    const summaries = await listCatalogueProducts(admin.client);
    expect(summaries.find((row) => row.id === platform)?.componentCount).toBe(1);
    expect(summaries.find((row) => row.id === part)?.partOfProductId).toBe(platform);
  });

  it('refuses itself, a second level, and a platform becoming a component; null clears it', async () => {
    const platform = (await saveCatalogueProduct(admin.client, null, 0, content('p2', 'Second Platform'))).productId;
    const part = (await saveCatalogueProduct(admin.client, null, 0, content('c2', 'Second Module', { partOfProductId: platform }))).productId;
    ids.push(platform, part);
    const self = await readCatalogueProduct(admin.client, platform);
    await expect(saveCatalogueProduct(admin.client, platform, self.product.edit_revision, { ...self.content, partOfProductId: platform })).rejects.toThrow();
    // A component cannot have components.
    await expect(saveCatalogueProduct(admin.client, null, 0, content('c3', 'Third Module', { partOfProductId: part }))).rejects.toThrow(/component/i);
    // A platform that has components cannot become a component.
    const other = (await saveCatalogueProduct(admin.client, null, 0, content('p4', 'Fourth Platform'))).productId;
    ids.push(other);
    await expect(saveCatalogueProduct(admin.client, platform, self.product.edit_revision, { ...self.content, partOfProductId: other })).rejects.toThrow(/components/i);
    const component = await readCatalogueProduct(admin.client, part);
    await saveCatalogueProduct(admin.client, part, component.product.edit_revision, { ...component.content, partOfProductId: null });
    expect((await readCatalogueProduct(admin.client, part)).partOf).toBeNull();
  });

  it('publishes a platform with no links of its own once it has a component, and not before', async () => {
    const platform = (await saveCatalogueProduct(admin.client, null, 0, content('p5', 'Fifth Platform', { claims: [{ position: 1, kind: 'functional' as const, statement: 'The vendor describes it.', sourceUrl: 'https://example.test/platform', sourceDate: '2026-11-27', review: true }] }))).productId;
    ids.push(platform);
    const detail = await readCatalogueProduct(admin.client, platform);
    await expect(saveCatalogueProduct(admin.client, platform, detail.product.edit_revision, { ...detail.content, publication: { action: 'publish' } })).rejects.toThrow(/capability link/i);
    const part = (await saveCatalogueProduct(admin.client, null, 0, content('c5', 'Fifth Module', { partOfProductId: platform }))).productId;
    ids.push(part);
    const again = await readCatalogueProduct(admin.client, platform);
    const published = await saveCatalogueProduct(admin.client, platform, again.product.edit_revision, { ...again.content, publication: { action: 'publish' } });
    expect(published.published).toBe(1);
  });

  it('publishes a platform with no claims only once one of its components is published, and refuses a user who is not a platform admin', async () => {
    const platform = (await saveCatalogueProduct(admin.client, null, 0, content('p7', 'Seventh Platform', { claims: [] }))).productId;
    const part = (await saveCatalogueProduct(admin.client, null, 0, content('c7', 'Seventh Module', {
      partOfProductId: platform,
      capabilities: [],
      claims: [{ position: 1, kind: 'functional' as const, statement: 'The vendor describes it.', sourceUrl: 'https://example.test/platform', sourceDate: '2026-11-27', review: true }],
    }))).productId;
    ids.push(platform, part);
    const before = await readCatalogueProduct(admin.client, platform);
    // No claims and no published component yet: refused, and the reason is the component.
    await expect(saveCatalogueProduct(admin.client, platform, before.product.edit_revision, { ...before.content, publication: { action: 'publish' } })).rejects.toThrow(/components is published/i);
    // A product that is not a platform still needs its claims.
    const lone = (await saveCatalogueProduct(admin.client, null, 0, content('l7', 'Lone Product', { claims: [] }))).productId;
    ids.push(lone);
    const loneDetail = await readCatalogueProduct(admin.client, lone);
    await expect(saveCatalogueProduct(admin.client, lone, loneDetail.product.edit_revision, { ...loneDetail.content, publication: { action: 'publish' } })).rejects.toThrow(/1-8 claims/i);
    // Someone signed in from another organisation cannot publish it, whatever its state.
    await expect(saveCatalogueProduct(outside.client, platform, before.product.edit_revision, { ...before.content, publication: { action: 'publish' } })).rejects.toThrow();
  });

  it('refuses a signed-in user who is not a platform admin', async () => {
    const platform = (await saveCatalogueProduct(admin.client, null, 0, content('p6', 'Sixth Platform'))).productId;
    ids.push(platform);
    await expect(saveCatalogueProduct(outside.client, null, 0, content('c6', 'Sixth Module', { partOfProductId: platform }))).rejects.toThrow();
    const direct = await outside.client.from('catalogue_products').update({ part_of_product_id: platform }).eq('id', platform).select();
    expect(direct.data ?? []).toEqual([]);
    expect(((await outside.client.from('catalogue_products').select('id').eq('id', platform)).data ?? []).length).toBe(0);
  });
});
