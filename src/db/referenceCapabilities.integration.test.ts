/** Real database round-trip and role boundary for ADR-036. Published test
 * content is immutable and remains in the disposable local database until
 * db:reset, as published starter maps do in the existing suite.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referenceCapabilityRowSchema, referenceCapabilityRevisionRowSchema, referenceMapItemLinkRowSchema } from '../contracts/referenceCapabilities';
import { createServiceRoleClient, createSupabaseClient } from './client';
import type { Client } from './client';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);
const anon = createSupabaseClient(env);

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `reference-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('reference capability identity, real database', () => {
  const capabilityId = randomUUID();
  const mapIds = [randomUUID(), randomUUID()];
  const itemIds = [randomUUID(), randomUUID()];
  const sectorSuffix = randomUUID().slice(0, 8);
  let admin: { id: string; client: Client };
  let otherOrgOwner: { id: string; client: Client };
  let otherOrgId: string | undefined;

  beforeAll(async () => {
    admin = await signedIn('admin');
    otherOrgOwner = await signedIn('other-owner');
    otherOrgId = randomUUID();
    await createOrganisation(otherOrgOwner.client, { id: otherOrgId, name: 'Other organisation',
      slug: `reference-other-${sectorSuffix}`, createdBy: otherOrgOwner.id });
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));

    check(await service.from('capability_maps').insert(mapIds.map((id, index) => ({ id,
      sector: `test_reference_${String(index)}_${sectorSuffix}`, version: 1, status: 'draft', source_description: 'Reference identity round-trip fixture' }))));
    check(await service.from('capability_map_items').insert(itemIds.map((id, index) => ({ id, map_id: mapIds[index],
      code: '5', parent_code: null, name: 'Customer Contact', description: 'Handle enquiries.', level: 1, item_order: 10 }))));
  });

  afterAll(async () => {
    if (otherOrgId !== undefined) await service.from('organisations').delete().eq('id', otherOrgId);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, otherOrgOwner]) {
      await user.client.auth.signOut();
      await service.auth.admin.deleteUser(user.id);
    }
  });

  it('links two explicitly reviewed map items to one identity, without changing either map item', async () => {
    const before = await service.from('reference_map_item_links').select('map_item_id').in('map_item_id', itemIds);
    check(before);
    expect(before.data).toEqual([]); // No name-based linking, even with identical names.

    check(await service.from('reference_capabilities').insert({ id: capabilityId, stable_key: `customer-contact-${sectorSuffix}` }));
    const identity = await service.from('reference_capabilities').select('*').eq('id', capabilityId).single();
    check(identity);
    expect(referenceCapabilityRowSchema.parse(identity.data).id).toBe(capabilityId);

    check(await service.from('reference_capability_revisions').insert({ capability_id: capabilityId, revision: 1,
      name: 'Customer Contact', definition: 'Handle enquiries and requests from the people served.', status: 'draft' }));
    const firstLink = { map_item_id: itemIds[0], capability_id: capabilityId, capability_revision: 1,
      review_basis: 'Reviewed shared Customer Contact definition.', mapped_by: admin.id };
    expect((await service.from('reference_map_item_links').insert(firstLink)).error).not.toBeNull();

    check(await service.from('reference_capability_revisions').update({ status: 'published', published_at: '2026-11-22T09:00:00Z' })
      .eq('capability_id', capabilityId).eq('revision', 1));
    check(await service.from('reference_map_item_links').insert(itemIds.map((itemId) => ({ ...firstLink, map_item_id: itemId }))));

    const revisions = await admin.client.from('reference_capability_revisions').select('*').eq('capability_id', capabilityId);
    check(revisions);
    expect(referenceCapabilityRevisionRowSchema.parse(revisions.data?.[0]).status).toBe('published');
    const links = await admin.client.from('reference_map_item_links').select('*').eq('capability_id', capabilityId);
    check(links);
    expect(links.data?.map((row) => referenceMapItemLinkRowSchema.parse(row).map_item_id).sort()).toEqual([...itemIds].sort());
    const items = await service.from('capability_map_items').select('id,name,code').in('id', itemIds);
    check(items);
    expect((items.data as { name: string }[] | null)?.map((item) => item.name)).toEqual(['Customer Contact', 'Customer Contact']);
  });

  it('keeps draft identities invisible to an owner in another organisation and denies client writes', async () => {
    for (const table of ['reference_capabilities', 'reference_capability_revisions', 'reference_map_item_links']) {
      const outside = await otherOrgOwner.client.from(table).select('*');
      check(outside);
      expect(outside.data).toEqual([]);
      expect((await anon.from(table).select('*')).error).not.toBeNull();
    }
    expect((await otherOrgOwner.client.from('reference_capabilities').insert({ id: randomUUID(), stable_key: 'injected' })).error).not.toBeNull();
    expect((await admin.client.from('reference_capabilities').insert({ id: randomUUID(), stable_key: 'admin-direct-write' })).error).not.toBeNull();
  });

  it('fixes published revisions and alignments while leaving old map semantics intact', async () => {
    expect((await service.from('reference_capability_revisions').update({ name: 'Renamed' })
      .eq('capability_id', capabilityId).eq('revision', 1)).error).not.toBeNull();
    expect((await service.from('reference_capabilities').update({ stable_key: 'different' }).eq('id', capabilityId)).error).not.toBeNull();
    check(await service.from('capability_maps').update({ status: 'published', published_at: '2026-11-22T09:00:00Z' }).eq('id', mapIds[0]));
    expect((await service.from('reference_map_item_links').update({ review_basis: 'Rewritten' }).eq('map_item_id', itemIds[0])).error).not.toBeNull();
    expect((await service.from('reference_map_item_links').delete().eq('map_item_id', itemIds[0])).error).not.toBeNull();
    const original = await service.from('capability_map_items').select('name,code').eq('id', itemIds[0]).single();
    check(original);
    expect(original.data).toMatchObject({ name: 'Customer Contact', code: '5' });
  });
});
