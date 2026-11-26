import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import {
  createCatalogueDraft,
  listCatalogueVersions,
  readCatalogueProduct,
  reviewProductClaims,
  saveCatalogueProduct,
  publishCatalogueDraft,
  validateCatalogueDraft,
} from './catalogueAdmin';
import type { CatalogueDraftContent, CatalogueProductContent } from '../contracts/catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
const suffix = randomUUID().slice(0, 8);
const seed = Number.parseInt(suffix.slice(0, 5), 16);
const mapVersion = 800000 + (seed % 100000);
const catalogueVersion = 810000 + (seed % 90000);

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `catalogue-admin-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

async function map(sector: string, name: string): Promise<string> {
  const id = randomUUID();
  check(await service.from('capability_maps').insert({
    id, sector, version: mapVersion, status: 'draft', title: name, summary: name,
    source_description: 'Integration test capability set.',
  }));
  check(await service.from('capability_map_items').insert({
    id: randomUUID(), map_id: id, code: '1', parent_code: null, name, description: `${name} definition.`, level: 1, item_order: 10,
  }));
  check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id));
  return id;
}

const claim = {
  position: 1,
  kind: 'functional' as const,
  statement: 'The vendor describes this product as a commerce platform.',
  sourceUrl: 'https://example.test/product',
  sourceDate: '2026-11-21',
};

describe('platform product catalogue, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let retailMapId: string;
  let utilityMapId: string;
  let productId: string;
  let productContent: CatalogueProductContent;

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    retailMapId = await map('retail_ecommerce', 'Retail capability');
    utilityMapId = await map('utility', 'Utility capability');
    productContent = {
      code: `test-product-${suffix}`,
      product: `Test product ${suffix}`,
      vendor: 'Test vendor',
      summary: 'A product used by the catalogue integration test.',
      capabilities: [
        { capabilityMapId: retailMapId, capabilityCode: '1', capabilityName: 'Retail capability', howItSupports: 'Supports the retail capability' },
        { capabilityMapId: utilityMapId, capabilityCode: '1', capabilityName: 'Utility capability', howItSupports: 'Supports the utility capability' },
      ],
      claims: [claim],
    };
  });

  afterAll(async () => {
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('keeps one product row with capability links in two sets', async () => {
    const saved = await saveCatalogueProduct(admin.client, null, 0, productContent);
    productId = saved.productId;
    expect(saved.revision).toBe(1);
    const detail = await readCatalogueProduct(admin.client, productId);
    expect(detail.content.product).toBe(productContent.product);
    expect(detail.content.capabilities).toHaveLength(2);
    expect(new Set(detail.content.capabilities.map((link) => link.capabilityMapId))).toEqual(new Set([retailMapId, utilityMapId]));
    // A claim a person types is drafted, not reviewed, and the server records who drafted it.
    expect(detail.claimReviews).toEqual([expect.objectContaining({ reviewState: 'drafted', origin: 'person', reviewedByName: null, reviewedAt: null })]);
    expect(detail.claimReviews[0]?.draftedByName).toBeTruthy();
  });

  it('blocks publication while a claim is waiting for review', async () => {
    const issues = await validateCatalogueDraft(admin.client, {
      sector: 'retail_ecommerce', version: catalogueVersion + 10, capabilityMapVersion: mapVersion,
      title: 'Waiting catalogue', sourceDescription: 'Not ready.', productIds: [productId],
    });
    expect(issues.join(' ')).toContain('waiting for review');
  });

  it('records who reviewed a claim on the server, and no browser can name a reviewer', async () => {
    const before = await readCatalogueProduct(admin.client, productId);
    const claimId = before.claimReviews[0]?.claimId ?? '';
    expect(await reviewProductClaims(admin.client, productId, [claimId])).toBe(1);
    const after = await readCatalogueProduct(admin.client, productId);
    expect(after.claimReviews[0]).toEqual(expect.objectContaining({ reviewState: 'reviewed' }));
    expect(after.claimReviews[0]?.reviewedByName).toBeTruthy();
    expect(after.claimReviews[0]?.reviewedAt).toBeTruthy();
    // Reviewing again changes nothing.
    expect(await reviewProductClaims(admin.client, productId, [claimId])).toBe(0);
    const events = await service.from('catalogue_product_events').select('action,actor_id,actor_name').eq('product_id', productId);
    check(events);
    expect(events.data).toContainEqual(expect.objectContaining({ action: 'reviewed', actor_id: admin.id }));
    // The actor's name is filled by the database, never supplied by the browser.
    const reviewedClaim = await service.from('catalogue_product_claims').select('reviewed_by_user').eq('id', claimId).single();
    check(reviewedClaim);
    expect((reviewedClaim.data as { reviewed_by_user: string }).reviewed_by_user).toBe(admin.id);
  });

  it('refuses a signed-in user from another organisation reviewing a claim', async () => {
    const denied = await outside.client.schema('atlas').rpc('save_catalogue_product', {
      p_id: productId, p_expected_revision: 2,
      p_content: { ...productContent, claims: [{ ...claim, review: true }] },
    });
    expect(denied.error).not.toBeNull();
    const direct = await outside.client.from('catalogue_product_claims').update({ review_state: 'reviewed' }).eq('product_id', productId);
    expect(direct.error).not.toBeNull();
    const claims = await service.from('catalogue_product_claims').select('reviewed_by_user').eq('product_id', productId);
    check(claims);
    expect(claims.data).toEqual([{ reviewed_by_user: admin.id }]);
  });

  it('refuses another signed-in user and direct client writes', async () => {
    const denied = await outside.client.schema('atlas').rpc('save_catalogue_product', {
      p_id: null, p_expected_revision: 0, p_content: productContent,
    });
    expect(denied.error).not.toBeNull();
    const direct = await outside.client.from('catalogue_products').insert({
      code: `sneaky-${suffix}`, product: 'Sneaky', vendor: 'Vendor', summary: 'No.',
      created_by: outside.id, updated_by: outside.id,
    });
    expect(direct.error).not.toBeNull();
  });

  it('publishes the same product into two sector catalogues under one product identity', async () => {
    for (const sector of ['retail_ecommerce', 'utility'] as const) {
      const content: CatalogueDraftContent = {
        sector, version: catalogueVersion + (sector === 'utility' ? 1 : 0), capabilityMapVersion: mapVersion,
        title: `${sector} test catalogue`, sourceDescription: 'Products checked for the integration test.',
        productIds: [productId],
      };
      const draftId = await createCatalogueDraft(admin.client, sector, content.version, null, content);
      const drafts = await admin.client.from('catalogue_drafts').select('*').eq('id', draftId).single();
      check(drafts);
      const draftRow = drafts.data as { id: string; base_catalogue_id: string | null; sector: string; version: number; content: CatalogueDraftContent; edit_revision: number; status: 'draft' | 'published'; published_catalogue_id: string | null; updated_at: string };
      expect(await validateCatalogueDraft(admin.client, content)).toEqual([]);
      const publishedId = await publishCatalogueDraft(admin.client, draftRow);
      expect(await listCatalogueVersions(admin.client)).toContainEqual(expect.objectContaining({ id: publishedId, sector, version: content.version, status: 'published' }));
      const entries = await service.from('catalogue_entries').select('product_id,code').eq('catalogue_id', publishedId);
      check(entries);
      expect(entries.data).toEqual([{ product_id: productId, code: productContent.code }]);
    }
    const products = await service.from('catalogue_products').select('id').eq('code', productContent.code);
    check(products);
    expect(products.data).toHaveLength(1);
  });

  it('sends a changed claim back to drafted and blocks publication again', async () => {
    const current = await readCatalogueProduct(admin.client, productId);
    const changed = await saveCatalogueProduct(admin.client, productId, current.product.edit_revision, {
      ...productContent, claims: [{ ...claim, statement: 'The vendor now describes this product as a retail commerce platform.' }],
    });
    expect(changed.reviewed).toBe(0);
    const detail = await readCatalogueProduct(admin.client, productId);
    expect(detail.claimReviews).toEqual([expect.objectContaining({ reviewState: 'drafted', reviewedByName: null })]);
    const issues = await validateCatalogueDraft(admin.client, {
      sector: 'retail_ecommerce', version: catalogueVersion + 10, capabilityMapVersion: mapVersion,
      title: 'Waiting catalogue', sourceDescription: 'Not ready.', productIds: [productId],
    });
    expect(issues.join(' ')).toContain('waiting for review');
  });
});
