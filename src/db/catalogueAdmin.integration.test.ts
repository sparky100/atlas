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
  publishCatalogueProduct,
  validateCatalogueDraft,
  withdrawCatalogueProduct,
} from './catalogueAdmin';
import { listPublishedProductsForCapability } from './publishedProducts';
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

async function map(sector: string, name: string, version = mapVersion): Promise<string> {
  const id = randomUUID();
  check(await service.from('capability_maps').insert({
    id, sector, version, status: 'draft', title: name, summary: name,
    source_description: 'Integration test capability set.',
  }));
  const itemId = randomUUID();
  check(await service.from('capability_map_items').insert({
    id: itemId, map_id: id, code: '1', parent_code: null, name, description: `${name} definition.`, level: 1, item_order: 10,
  }));
  itemIds.set(id, itemId);
  check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id));
  return id;
}

const itemIds = new Map<string, string>();

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
    // A save writes the claim rows afresh, so look the claim up by its product, not by the id read before the save.
    const reviewedClaim = await service.from('catalogue_product_claims').select('reviewed_by_user').eq('product_id', productId);
    check(reviewedClaim);
    expect(reviewedClaim.data).toEqual([{ reviewed_by_user: admin.id }]);
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
  describe('linking by meaning', () => {
    let sharedId: string;
    let sharedProductId: string;
    let sectorProductId: string;
    const sharedContent = (): CatalogueProductContent => ({
      code: `test-shared-${suffix}`, product: `Shared product ${suffix}`, vendor: 'Test vendor',
      summary: 'A product that supports a shared capability.', capabilities: [],
      generalCapabilities: [{ capabilityId: sharedId, howItSupports: 'Runs the shared capability in every sector' }],
      claims: [{ ...claim, review: true }],
    });

    it('aligns two sets to one shared capability and links a product to it once', async () => {
      sharedId = randomUUID();
      check(await service.from('reference_capabilities').insert({ id: sharedId, stable_key: `test-shared-${suffix}` }));
      check(await service.from('reference_capability_revisions').insert({
        capability_id: sharedId, revision: 1, name: 'Shared capability', definition: 'Same meaning everywhere.',
        status: 'published', published_at: new Date().toISOString(),
      }));
      for (const mapId of [retailMapId, utilityMapId]) {
        check(await service.from('reference_map_item_links').insert({
          map_item_id: itemIds.get(mapId), capability_id: sharedId, capability_revision: 1,
          review_basis: 'Integration test alignment.', mapped_by: admin.id,
        }));
      }
      const saved = await saveCatalogueProduct(admin.client, null, 0, sharedContent());
      sharedProductId = saved.productId;
      const detail = await readCatalogueProduct(admin.client, sharedProductId);
      expect(detail.content.generalCapabilities).toEqual([{ capabilityId: sharedId, howItSupports: 'Runs the shared capability in every sector' }]);
      expect(detail.content.capabilities).toEqual([]);
    });

    it('counts and publishes the shared link in every sector that aligns to it', async () => {
      for (const [sector, name, offset] of [['retail_ecommerce', 'Retail capability', 20], ['utility', 'Utility capability', 21]] as const) {
        const content: CatalogueDraftContent = {
          sector, version: catalogueVersion + offset, capabilityMapVersion: mapVersion,
          title: `${sector} shared catalogue`, sourceDescription: 'Shared link test.', productIds: [sharedProductId],
        };
        expect(await validateCatalogueDraft(admin.client, content)).toEqual([]);
        const draftId = await createCatalogueDraft(admin.client, sector, content.version, null, content);
        const drafts = await admin.client.from('catalogue_drafts').select('*').eq('id', draftId).single();
        check(drafts);
        const publishedId = await publishCatalogueDraft(admin.client, drafts.data as Parameters<typeof publishCatalogueDraft>[1]);
        const entry = await service.from('catalogue_entries').select('id').eq('catalogue_id', publishedId).single();
        check(entry);
        const links = await service.from('catalogue_entry_capabilities').select('capability_code,capability_name,how_it_supports').eq('entry_id', (entry.data as { id: string }).id);
        check(links);
        // The pinned set's own wording is used for each sector.
        expect(links.data).toEqual([{ capability_code: '1', capability_name: name, how_it_supports: 'Runs the shared capability in every sector' }]);
      }
    });

    it('refuses an unknown shared capability and a duplicate shared link', async () => {
      const unknown = { ...sharedContent(), code: `test-unknown-${suffix}`, generalCapabilities: [{ capabilityId: randomUUID(), howItSupports: 'x' }] };
      await expect(saveCatalogueProduct(admin.client, null, 0, unknown)).rejects.toThrow(/unknown or not published/);
      const current = await readCatalogueProduct(admin.client, sharedProductId);
      const duplicate = { ...current.content, generalCapabilities: [...(current.content.generalCapabilities ?? []), ...(current.content.generalCapabilities ?? [])] };
      await expect(saveCatalogueProduct(admin.client, sharedProductId, current.product.edit_revision, duplicate)).rejects.toThrow();
    });

    it('keeps a sector link working when the sector publishes a new version of its set', async () => {
      const content: CatalogueProductContent = {
        code: `test-sector-${suffix}`, product: `Sector product ${suffix}`, vendor: 'Test vendor',
        summary: 'A product with one sector link.',
        capabilities: [{ capabilityMapId: retailMapId, capabilityCode: '1', capabilityName: 'Retail capability', howItSupports: 'Supports retail' }],
        claims: [{ ...claim, review: true }],
      };
      sectorProductId = (await saveCatalogueProduct(admin.client, null, 0, content)).productId;
      await map('retail_ecommerce', 'Retail capability reworded', mapVersion + 1);
      const issues = await validateCatalogueDraft(admin.client, {
        sector: 'retail_ecommerce', version: catalogueVersion + 22, capabilityMapVersion: mapVersion + 1,
        title: 'Carry-over catalogue', sourceDescription: 'Carry-over test.', productIds: [sectorProductId],
      });
      expect(issues).toEqual([]);
      // A set in another sector does not count a link that belongs to the retail sector.
      const other = await validateCatalogueDraft(admin.client, {
        sector: 'utility', version: catalogueVersion + 23, capabilityMapVersion: mapVersion,
        title: 'Other sector', sourceDescription: 'Other sector test.', productIds: [sectorProductId],
      });
      expect(other.join(' ')).toContain('needs 1-10 capability links that apply to this capability set');
    });

    it('does not let another signed-in user read or write shared links', async () => {
      const read = await outside.client.from('catalogue_product_general_links').select('product_id');
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
      const write = await outside.client.from('catalogue_product_general_links').insert({
        product_id: sharedProductId, capability_id: sharedId, how_it_supports: 'No.',
      });
      expect(write.error).not.toBeNull();
      const helper = await outside.client.schema('atlas').rpc('catalogue_product_links_in_map', { p_product: sharedProductId, p_map: retailMapId });
      expect(helper.error).not.toBeNull();
    });
  });
  describe('publishing a product', () => {
    let pid: string;
    const content = (): CatalogueProductContent => ({
      code: `test-publish-${suffix}`, product: `Publish product ${suffix}`, vendor: 'Test vendor',
      summary: 'A product used to test publication.',
      capabilities: [{ capabilityMapId: retailMapId, capabilityCode: '1', capabilityName: 'Retail capability', howItSupports: 'Supports retail' }],
      claims: [claim],
    });

    it('refuses to publish while a claim is waiting for review, and saves nothing', async () => {
      await expect(saveCatalogueProduct(admin.client, null, 0, { ...content(), publication: { action: 'publish' } })).rejects.toThrow(/waiting for review/);
      const found = await service.from('catalogue_products').select('id').eq('code', content().code);
      check(found);
      expect(found.data).toEqual([]);
    });

    it('freezes a revision and records who approved it', async () => {
      pid = (await saveCatalogueProduct(admin.client, null, 0, { ...content(), claims: [{ ...claim, review: true }] })).productId;
      const first = await readCatalogueProduct(admin.client, pid);
      expect(first.publication).toBeNull();
      expect(await publishCatalogueProduct(admin.client, pid)).toBe(1);
      const detail = await readCatalogueProduct(admin.client, pid);
      expect(detail.publication).toEqual(expect.objectContaining({ revision: 1, withdrawnAt: null, unpublishedChanges: false }));
      expect(detail.publication?.approvedByName).toBeTruthy();
      const revision = await service.from('catalogue_product_revisions').select('id,published_by,vendor').eq('product_id', pid).single();
      check(revision);
      expect(revision.data).toEqual(expect.objectContaining({ published_by: admin.id, vendor: 'Test vendor' }));
      const links = await service.from('catalogue_product_revision_links').select('kind,sector,capability_code').eq('revision_id', (revision.data as { id: string }).id);
      check(links);
      expect(links.data).toEqual([{ kind: 'sector', sector: 'retail_ecommerce', capability_code: '1' }]);
      const claims = await service.from('catalogue_product_revision_claims').select('reviewed_by_user').eq('revision_id', (revision.data as { id: string }).id);
      check(claims);
      expect(claims.data).toEqual([{ reviewed_by_user: admin.id }]);
    });

    it('does not change what was published when the product is edited, and the next publish is revision 2', async () => {
      const current = await readCatalogueProduct(admin.client, pid);
      await saveCatalogueProduct(admin.client, pid, current.product.edit_revision, { ...current.content, summary: 'A changed summary.' });
      const edited = await readCatalogueProduct(admin.client, pid);
      expect(edited.publication).toEqual(expect.objectContaining({ revision: 1, unpublishedChanges: true }));
      const frozen = await service.from('catalogue_product_revisions').select('summary').eq('product_id', pid).eq('revision', 1).single();
      check(frozen);
      expect(frozen.data).toEqual({ summary: 'A product used to test publication.' });
      expect(await publishCatalogueProduct(admin.client, pid)).toBe(2);
    });

    it('withdraws with a reason, keeps the revision, and refuses a second withdrawal', async () => {
      await withdrawCatalogueProduct(admin.client, pid, 'The vendor sold the product.');
      const detail = await readCatalogueProduct(admin.client, pid);
      expect(detail.publication).toEqual(expect.objectContaining({ revision: 2, withdrawnReason: 'The vendor sold the product.' }));
      await expect(withdrawCatalogueProduct(admin.client, pid, 'Again.')).rejects.toThrow(/not published/);
      const rows = await service.from('catalogue_product_revisions').select('revision').eq('product_id', pid);
      check(rows);
      expect(rows.data).toHaveLength(2);
    });

    it('never lets a published revision be changed or deleted', async () => {
      const edit = await service.from('catalogue_product_revisions').update({ summary: 'Changed.' }).eq('product_id', pid);
      expect(edit.error).not.toBeNull();
      const del = await service.from('catalogue_product_revision_claims').delete().neq('position', 0);
      expect(del.error).not.toBeNull();
    });

    it('does not let another signed-in user read revisions, publish or withdraw', async () => {
      const read = await outside.client.from('catalogue_product_revisions').select('id');
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
      const publish = await outside.client.schema('atlas').rpc('save_catalogue_product', {
        p_id: pid, p_expected_revision: 99, p_content: { ...content(), claims: [{ ...claim, review: true }], publication: { action: 'publish' } },
      });
      expect(publish.error).not.toBeNull();
      const write = await outside.client.from('catalogue_product_revisions').insert({
        product_id: pid, revision: 9, product_edit_revision: 1, code: 'x', product: 'x', vendor: 'x', summary: 'x', published_by: outside.id,
      });
      expect(write.error).not.toBeNull();
    });
  });
  describe('reading published products as another signed-in user', () => {
    let pid: string;
    let sharedCapabilityId: string;
    const content = (): CatalogueProductContent => ({
      code: `test-read-${suffix}`, product: `Read product ${suffix}`, vendor: 'Test vendor',
      summary: 'First summary.', capabilities: [],
      generalCapabilities: [{ capabilityId: sharedCapabilityId, howItSupports: 'Runs the shared capability' }],
      claims: [{ ...claim, review: true }],
    });
    const names = async (sector: string): Promise<string[]> =>
      (await listPublishedProductsForCapability(outside.client, { sector, capabilityCode: '1' })).map((p) => p.product);

    it('shows nothing before the product is published', async () => {
      const link = await service.from('reference_map_item_links').select('capability_id').eq('map_item_id', itemIds.get(retailMapId)).single();
      check(link);
      sharedCapabilityId = (link.data as { capability_id: string }).capability_id;
      pid = (await saveCatalogueProduct(admin.client, null, 0, content())).productId;
      expect(await names('utility')).not.toContain(`Read product ${suffix}`);
    });

    it('shows a published product in every sector that aligns to its shared capability, with its claims', async () => {
      await publishCatalogueProduct(admin.client, pid);
      for (const sector of ['utility', 'retail_ecommerce']) expect(await names(sector)).toContain(`Read product ${suffix}`);
      const found = (await listPublishedProductsForCapability(outside.client, { sector: 'utility', capabilityCode: '1' })).find((p) => p.productId === pid);
      expect(found).toEqual(expect.objectContaining({ revision: 1, vendor: 'Test vendor', howItSupports: 'Runs the shared capability' }));
      expect(found?.approvedByName).toBeTruthy();
      expect(found?.claims).toEqual([expect.objectContaining({ statement: claim.statement, origin: 'person' })]);
    });

    it('keeps showing the published revision while the product has unpublished changes, then the newest revision once', async () => {
      const current = await readCatalogueProduct(admin.client, pid);
      await saveCatalogueProduct(admin.client, pid, current.product.edit_revision, { ...current.content, summary: 'Edited, not published.' });
      const before = (await listPublishedProductsForCapability(outside.client, { sector: 'utility', capabilityCode: '1' })).filter((p) => p.productId === pid);
      expect(before).toEqual([expect.objectContaining({ revision: 1, summary: 'First summary.' })]);
      await publishCatalogueProduct(admin.client, pid);
      const after = (await listPublishedProductsForCapability(outside.client, { sector: 'utility', capabilityCode: '1' })).filter((p) => p.productId === pid);
      expect(after).toEqual([expect.objectContaining({ revision: 2, summary: 'Edited, not published.' })]);
    });

    it('does not expose who published or aligned, only the names', async () => {
      const who = await outside.client.from('catalogue_product_revisions').select('published_by').eq('product_id', pid);
      expect(who.error).not.toBeNull();
      const basis = await outside.client.from('reference_map_item_links').select('review_basis, mapped_by');
      expect(basis.error).not.toBeNull();
    });

    it('stops showing a withdrawn product', async () => {
      await withdrawCatalogueProduct(admin.client, pid, 'The vendor sold the product.');
      expect(await names('utility')).not.toContain(`Read product ${suffix}`);
      const hidden = await outside.client.from('catalogue_product_revisions').select('id').eq('product_id', pid);
      expect(hidden.data).toEqual([]);
    });
  });
});
