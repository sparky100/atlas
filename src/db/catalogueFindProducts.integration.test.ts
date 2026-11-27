/**
 * Catalogue step 6a, real database: a product the Researcher found is saved as a
 * draft whose claims are marked "researcher", a person's own claim cannot be
 * made to look Researcher-found by re-saving a kept claim, a signed-in user
 * who is not a platform admin cannot save one, and a "find" run records its
 * searches and products found.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { finishCheckRun, listCheckRuns, readCatalogueProduct, saveFoundComponents, saveFoundProducts, startCheckRun } from './catalogueAdmin';
import { saveCatalogueProduct } from './catalogueAdmin';
import type { FoundProduct } from '../tools/catalogueFindProducts';

const env = loadEnv();
const service = createServiceRoleClient(env);
const seed = randomUUID().slice(0, 8);
// Letters only: a hex tail such as "3cad" reads as a currency code to the no-prices rule and flakes the save.
const suffix = seed.replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
const mapVersion = 890000 + (Number.parseInt(seed.slice(0, 5), 16) % 60000);

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `find-products-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue find products, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let mapId: string;
  const link = () => ({ capabilityMapId: mapId, capabilityCode: '1', capabilityName: 'Find products capability' });
  const found: FoundProduct = {
    product: `Finder product ${suffix}`, vendor: 'Finder vendor', summary: 'Found for the integration test.', howItSupports: 'Supports the capability.',
    claims: [{ kind: 'functional', sourceUrl: `https://example.test/find-${suffix}`, statement: 'The vendor says this product does the thing.' }],
  };
  const savedIds: string[] = [];
  const runIds: string[] = [];

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    mapId = randomUUID();
    check(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: mapVersion, status: 'draft', title: 'Find products set', summary: 'Find products set', source_description: 'Integration test.' }));
    check(await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: 'Find products capability', description: 'Definition.', level: 1, item_order: 10 }));
    check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
  });

  afterAll(async () => {
    for (const id of runIds) await service.from('catalogue_check_runs').delete().eq('id', id);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('saves a found product as a draft linked to the capability, with claims marked as found by the Researcher', async () => {
    const result = await saveFoundProducts(admin.client, [found], link(), [], '2026-11-27');
    expect(result.failed).toEqual([]);
    const first = result.saved[0];
    if (!first) throw new Error('nothing saved');
    savedIds.push(first.productId);
    const detail = await readCatalogueProduct(admin.client, first.productId);
    expect(detail.content.capabilities).toHaveLength(1);
    expect(detail.claimReviews[0]).toMatchObject({ origin: 'researcher', reviewState: 'drafted', reviewedByName: null });
    expect(detail.claimReviews[0]?.draftedByName).toBeTruthy();
    expect(detail.publication).toBeNull();
  });

  it('marks a claim as researcher-found only when it is new in the save, and keeps an earlier origin', async () => {
    const detail = await readCatalogueProduct(admin.client, savedIds[0] ?? '');
    const kept = detail.content.claims[0];
    if (!kept) throw new Error('no claim');
    // Re-saving the same claim without the marker keeps it Researcher-found.
    await saveCatalogueProduct(admin.client, detail.product.id, detail.product.edit_revision, { ...detail.content, claims: [{ ...kept, origin: undefined }] });
    let after = await readCatalogueProduct(admin.client, savedIds[0] ?? '');
    expect(after.claimReviews[0]?.origin).toBe('researcher');
    // A new claim without the marker is a person's.
    await saveCatalogueProduct(admin.client, after.product.id, after.product.edit_revision, {
      ...after.content, claims: [...after.content.claims, { position: 2, kind: 'deployment', statement: 'The vendor says it is hosted.', sourceUrl: kept.sourceUrl, sourceDate: '2026-11-27' }],
    });
    after = await readCatalogueProduct(admin.client, savedIds[0] ?? '');
    expect(after.claimReviews.map((review) => review.origin).sort()).toEqual(['person', 'researcher']);
  });

  it('saves a found component with its platform: one draft platform is made once and reused, a platform already in the library is reused', async () => {
    const vendor = `Platvendor ${suffix}`;
    const platform = `Platfam ${suffix}`;
    const part = (name: string): FoundProduct => ({ ...found, product: `${platform} ${name}`, vendor, platform });
    const first = await saveFoundProducts(admin.client, [part('Alpha'), part('Beta')], link(), [], '2026-11-27');
    expect(first.failed).toEqual([]);
    expect(first.platformsCreated).toEqual([platform]);
    const ids = first.saved.map((row) => row.productId);
    savedIds.push(...ids);
    const alpha = await readCatalogueProduct(admin.client, ids[0] ?? '');
    const beta = await readCatalogueProduct(admin.client, ids[1] ?? '');
    expect(alpha.partOf?.product).toBe(platform);
    expect(beta.content.partOfProductId).toBe(alpha.content.partOfProductId);
    // The platform is a draft with no links and no claims.
    const platformDetail = await readCatalogueProduct(admin.client, alpha.content.partOfProductId ?? '');
    expect(platformDetail.content.capabilities).toEqual([]);
    expect(platformDetail.content.claims).toEqual([]);
    expect(platformDetail.publication).toBeNull();
    savedIds.push(platformDetail.product.id);
    // A later search finds a third component: the existing platform is reused, none is created.
    const again = await saveFoundProducts(admin.client, [part('Gamma')], link(), [{ id: platformDetail.product.id, code: platformDetail.product.code, vendor, product: platform }], '2026-11-27');
    expect(again.platformsCreated).toEqual([]);
    const gamma = await readCatalogueProduct(admin.client, again.saved[0]?.productId ?? '');
    savedIds.push(again.saved[0]?.productId ?? '');
    expect(gamma.content.partOfProductId).toBe(platformDetail.product.id);
  });

  it('saves the product on its own when the named platform is itself a component', async () => {
    const vendor = `Nestvendor ${suffix}`;
    const top = await saveFoundProducts(admin.client, [{ ...found, product: `Nesttop ${suffix}`, vendor }], link(), [], '2026-11-27');
    const topId = top.saved[0]?.productId ?? '';
    savedIds.push(topId);
    const mid = await saveFoundProducts(admin.client, [{ ...found, product: `Nestmid ${suffix}`, vendor, platform: `Nesttop ${suffix}` }], link(), [{ id: topId, code: 'x', vendor, product: `Nesttop ${suffix}` }], '2026-11-27');
    expect(mid.failed).toEqual([]);
    savedIds.push(mid.saved[0]?.productId ?? '');
    // Nestmid is now a component of Nesttop. A product naming Nestmid as its platform cannot nest one more level.
    const low = await saveFoundProducts(admin.client, [{ ...found, product: `Nestlow ${suffix}`, vendor, platform: `Nestmid ${suffix}` }], link(), [{ id: mid.saved[0]?.productId ?? '', code: 'y', vendor, product: `Nestmid ${suffix}` }], '2026-11-27');
    expect(low.failed).toEqual([]);
    savedIds.push(low.saved[0]?.productId ?? '');
    expect(low.saved[0]?.platform).toBeNull();
    const detail = await readCatalogueProduct(admin.client, low.saved[0]?.productId ?? '');
    expect(detail.content.partOfProductId ?? null).toBeNull();
  });

  it('saves found modules as draft components of a platform, with no capability links', async () => {
    const vendor = `Compvendor ${suffix}`;
    const platformSaved = await saveFoundProducts(admin.client, [{ ...found, product: `Compplat ${suffix}`, vendor }], link(), [], '2026-11-27');
    const platformId = platformSaved.saved[0]?.productId ?? '';
    savedIds.push(platformId);
    const part = (name: string): FoundProduct => ({ ...found, product: `Compplat ${suffix} ${name}`, vendor, platform: `Compplat ${suffix}` });
    const result = await saveFoundComponents(admin.client, platformId, [part('Alpha'), part('Beta')], [], '2026-11-27');
    expect(result.failed).toEqual([]);
    expect(result.saved).toHaveLength(2);
    for (const row of result.saved) savedIds.push(row.productId);
    const alpha = await readCatalogueProduct(admin.client, result.saved[0]?.productId ?? '');
    expect(alpha.content.partOfProductId).toBe(platformId);
    expect(alpha.content.capabilities).toEqual([]);
    expect(alpha.claimReviews[0]).toMatchObject({ origin: 'researcher', reviewState: 'drafted' });
    const platformDetail = await readCatalogueProduct(admin.client, platformId);
    expect(platformDetail.components.map((c) => c.product).sort()).toEqual([`Compplat ${suffix} Alpha`, `Compplat ${suffix} Beta`]);
  });

  it('refuses a signed-in user who is not a platform admin', async () => {
    const result = await saveFoundProducts(outside.client, [{ ...found, product: `Other ${suffix}` }], link(), [], '2026-11-27');
    expect(result.saved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    await expect(startCheckRun(outside.client, 'find')).rejects.toThrow();
  });

  it('records a find run with its searches and products found', async () => {
    const id = await startCheckRun(admin.client, 'find');
    runIds.push(id);
    await finishCheckRun(admin.client, id, { status: 'finished', linksChecked: 0, claimsChecked: 0, flagged: 0, searches: 4, productsFound: 3, tokens: { input: 5000, output: 700 }, note: null });
    const run = (await listCheckRuns(admin.client, 20)).find((candidate) => candidate.id === id);
    expect(run).toMatchObject({ kind: 'manual', scope: 'find', status: 'finished', searches: 4, productsFound: 3, tokens: 5700 });
    const bad = await admin.client.from('catalogue_check_runs').insert({ kind: 'manual', scope: 'other' });
    expect(bad.error).not.toBeNull();
  });
});
