/**
 * Published versions record the platform, real database: a component's
 * published version names its platform and a platform's names its components,
 * as they were when it was published; a product that is not published is never
 * named; a withdrawn one is not named either; another signed-in user reads the
 * names through the published reader.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { publishCatalogueProduct, readCatalogueProduct, saveCatalogueProduct, withdrawCatalogueProduct } from './catalogueAdmin';
import { listPublishedProductsForCapability } from './publishedProducts';
import { listCurrentCatalogueEntriesForCapability } from './productCatalogue';

const env = loadEnv();
const service = createServiceRoleClient(env);
// Letters only: a hex tail such as 3cad reads as a currency code to the no-prices rule.
const suffix = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
const mapVersion = 700000 + (Number.parseInt(randomUUID().slice(0, 5), 16) % 200000);

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `platform-revisions-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('published versions record the platform, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let mapId = '';
  const ids: string[] = [];
  const vendor = `Revvendor ${suffix}`;
  const claim = { position: 1, kind: 'functional' as const, statement: 'The vendor describes this product.', sourceUrl: 'https://example.test/platform-revisions', sourceDate: '2026-11-27', review: true };
  const content = (code: string, product: string, extra: Record<string, unknown> = {}) => ({
    code: `${code}-${suffix}`, product: `${product} ${suffix}`, vendor, summary: 'Used by the platform revision test.',
    capabilities: [{ capabilityMapId: mapId, capabilityCode: '1', capabilityName: `Revision test ${suffix}`, howItSupports: 'Supports it.' }],
    claims: [claim], ...extra,
  });
  const make = async (code: string, product: string, extra: Record<string, unknown> = {}): Promise<string> => {
    const saved = await saveCatalogueProduct(admin.client, null, 0, content(code, product, extra));
    ids.push(saved.productId);
    return saved.productId;
  };
  const published = async (productId: string) =>
    (await listPublishedProductsForCapability(outside.client, { sector: 'utility', capabilityCode: '1' })).find((row) => row.productId === productId);

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    mapId = randomUUID();
    check(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: mapVersion, status: 'draft', title: 'Revision test set', summary: 'Revision test set', source_description: 'Integration test capability set.' }));
    check(await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: `Revision test ${suffix}`, description: 'Definition.', level: 1, item_order: 10 }));
    check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
  });

  afterAll(async () => {
    await service.from('catalogue_products').update({ part_of_product_id: null }).in('id', ids);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('records the platform on a component and the published components on a platform, and names no unpublished product', async () => {
    const platform = await make('plat', 'Revplatform');
    const one = await make('one', 'Revplatform Network', { partOfProductId: platform });
    const two = await make('two', 'Revplatform Billing', { partOfProductId: platform });
    // The component is published before its platform: no platform to name yet.
    await publishCatalogueProduct(admin.client, one);
    expect((await published(one))?.partOf).toBeNull();
    // The platform is published with one published component and one draft: only the published one is named.
    await publishCatalogueProduct(admin.client, platform);
    const found = await published(platform);
    expect(found?.components).toEqual([`Revplatform Network ${suffix}`]);
    expect(found?.partOf).toBeNull();
    // A component published after its platform names it.
    await publishCatalogueProduct(admin.client, two);
    expect((await published(two))?.partOf).toBe(`Revplatform ${suffix}`);
    // The reader the screens use carries it through.
    const entries = await listCurrentCatalogueEntriesForCapability(outside.client, { sector: 'utility', capabilityCode: '1' });
    expect(entries.find((entry) => entry.code === `two-${suffix}`)?.platform).toEqual({ partOf: `Revplatform ${suffix}`, components: [] });
    // Republishing the platform picks up the second component.
    const current = await readCatalogueProduct(admin.client, platform);
    await saveCatalogueProduct(admin.client, platform, current.product.edit_revision, { ...current.content, summary: 'Edited so it can be published again.' });
    await publishCatalogueProduct(admin.client, platform);
    expect((await published(platform))?.components).toEqual([`Revplatform Billing ${suffix}`, `Revplatform Network ${suffix}`]);
  });

  it('does not name a withdrawn platform on a later component version', async () => {
    const platform = await make('plat2', 'Withdrawnplatform');
    await publishCatalogueProduct(admin.client, platform);
    const part = await make('part2', 'Withdrawnplatform Module', { partOfProductId: platform });
    await withdrawCatalogueProduct(admin.client, platform, 'The vendor sold the product.');
    await publishCatalogueProduct(admin.client, part);
    expect((await published(part))?.partOf).toBeNull();
  });

  it('keeps who published a version hidden from other signed-in users, and the new columns frozen', async () => {
    const who = await outside.client.from('catalogue_product_revisions').select('published_by').limit(1);
    expect(who.error).not.toBeNull();
    const edit = await service.from('catalogue_product_revisions').update({ part_of_name: 'Changed' }).eq('product_id', ids[0] ?? randomUUID());
    expect(edit.error).not.toBeNull();
  });
});
