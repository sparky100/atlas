/**
 * Catalogue step 5a, real database: link-check results are readable and
 * writable by platform admins only, the server stamps who and when, and a
 * flagged link is matched to the claim and product that cite it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { listDistinctSourceUrls, listFlaggedSourceLinks, listSourceChecks, saveCatalogueProduct, saveSourceChecks } from './catalogueAdmin';
import type { CatalogueProductContent } from '../contracts/catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
const suffix = randomUUID().slice(0, 8);
const mapVersion = 820000 + (Number.parseInt(suffix.slice(0, 5), 16) % 70000);
const goneUrl = `https://example.test/gone-${suffix}`;
const worksUrl = `https://example.test/works-${suffix}`;

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `source-check-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue source-link checks, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let productId: string;

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    const mapId = randomUUID();
    check(await service.from('capability_maps').insert({ id: mapId, sector: 'utility', version: mapVersion, status: 'draft', title: 'Source check set', summary: 'Source check set', source_description: 'Integration test.' }));
    check(await service.from('capability_map_items').insert({ id: randomUUID(), map_id: mapId, code: '1', parent_code: null, name: 'Source check capability', description: 'Definition.', level: 1, item_order: 10 }));
    check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', mapId));
    const content: CatalogueProductContent = {
      code: `source-check-${suffix}`,
      product: `Source check product ${suffix}`,
      vendor: 'Source check vendor',
      summary: 'A product used by the source-check integration test.',
      capabilities: [{ capabilityMapId: mapId, capabilityCode: '1', capabilityName: 'Source check capability', howItSupports: 'Supports it' }],
      claims: [
        { position: 1, kind: 'functional', statement: 'The vendor describes this as a gone page.', sourceUrl: goneUrl, sourceDate: '2026-11-21' },
        { position: 2, kind: 'deployment', statement: 'The vendor describes this as a working page.', sourceUrl: worksUrl, sourceDate: '2026-11-21' },
      ],
    };
    productId = (await saveCatalogueProduct(admin.client, null, 0, content)).productId;
  });

  afterAll(async () => {
    await service.from('catalogue_source_checks').delete().in('url', [goneUrl, worksUrl]);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('lets an admin save checks, stamps who and when on the server, and replaces an earlier check', async () => {
    expect(await listDistinctSourceUrls(admin.client)).toEqual(expect.arrayContaining([goneUrl, worksUrl]));
    await saveSourceChecks(admin.client, [
      { url: goneUrl, result: 'gone', httpStatus: 404, finalUrl: null, note: null },
      { url: worksUrl, result: 'works', httpStatus: 200, finalUrl: null, note: null },
    ]);
    const saved = (await listSourceChecks(admin.client)).filter((row) => row.url === goneUrl || row.url === worksUrl);
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.checkedByName !== null && row.checkedByName !== '')).toBe(true);
    const stored = await service.from('catalogue_source_checks').select('checked_by').eq('url', goneUrl).single();
    expect((stored.data as { checked_by: string }).checked_by).toBe(admin.id);

    // A forged name, person or time in the request is overwritten by the server.
    check(await admin.client.from('catalogue_source_checks').upsert({
      url: goneUrl, result: 'moved', http_status: 200, final_url: 'https://example.test/new', checked_by: outside.id, checked_by_name: 'Somebody Else', checked_at: '2000-01-01T00:00:00Z',
    }, { onConflict: 'url' }));
    const after = await service.from('catalogue_source_checks').select('result,checked_by,checked_by_name,checked_at').eq('url', goneUrl).single();
    const row = after.data as { result: string; checked_by: string; checked_by_name: string; checked_at: string };
    expect(row.result).toBe('moved');
    expect(row.checked_by).toBe(admin.id);
    expect(row.checked_by_name).not.toBe('Somebody Else');
    expect(new Date(row.checked_at).getFullYear()).toBeGreaterThan(2000);
    await saveSourceChecks(admin.client, [{ url: goneUrl, result: 'gone', httpStatus: 404, finalUrl: null, note: null }]);
  });

  it('names the product and claim behind each link that is not working, and leaves working links out', async () => {
    const flagged = await listFlaggedSourceLinks(admin.client, await listSourceChecks(admin.client));
    const mine = flagged.filter((item) => item.check.url === goneUrl || item.check.url === worksUrl);
    expect(mine.map((item) => item.check.url)).toEqual([goneUrl]);
    expect(mine[0]?.claims).toEqual([expect.objectContaining({ productId, position: 1, productName: `Source check product ${suffix}` })]);
  });

  it('shows and accepts nothing from a signed-in user who is not a platform admin, or from a signed-out caller', async () => {
    expect(await listSourceChecks(outside.client)).toEqual([]);
    await expect(saveSourceChecks(outside.client, [{ url: `${goneUrl}-x`, result: 'works', httpStatus: 200, finalUrl: null, note: null }])).rejects.toThrow();
    const update = await outside.client.from('catalogue_source_checks').update({ result: 'works' }).eq('url', goneUrl).select();
    expect(update.data ?? []).toEqual([]);
    const remove = await outside.client.from('catalogue_source_checks').delete().eq('url', goneUrl).select();
    expect(remove.data ?? []).toEqual([]);
    const still = await service.from('catalogue_source_checks').select('result').eq('url', goneUrl).single();
    expect((still.data as { result: string }).result).toBe('gone');

    const anon = createSupabaseClient(env);
    const read = await anon.from('catalogue_source_checks').select('url');
    expect(read.error !== null || ((read.data as unknown[] | null) ?? []).length === 0).toBe(true);
    const write = await anon.from('catalogue_source_checks').insert({ url: `${goneUrl}-anon`, result: 'works' });
    expect(write.error).not.toBeNull();
  });

  it('refuses a result the table does not allow', async () => {
    const bad = await admin.client.from('catalogue_source_checks').insert({ url: `${goneUrl}-bad`, result: 'fine' });
    expect(bad.error).not.toBeNull();
  });
});
