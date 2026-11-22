import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { alignDraftItem, createReferenceMapDraft, publishReferenceMapDraft, readReferenceMap, saveReferenceMapDraft, validateReferenceMap, type ReferenceMapDraft } from './referenceMapAdmin';
import type { CapabilityMapContent } from '../contracts/capabilityMapContent';

const env = loadEnv();
const service = createServiceRoleClient(env);
const anon = createSupabaseClient(env);
const sector = `test_map_admin_${randomUUID().slice(0, 8)}`;

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `map-admin-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('platform capability-set publishing, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let draftId: string;
  const baseId = randomUUID();
  const baseItemId = randomUUID();
  const existingIdentityId = randomUUID();
  const content: CapabilityMapContent = {
    sector: sector as CapabilityMapContent['sector'], version: 2, status: 'draft', title: 'New customer connection',
    summary: 'The work needed to connect a new customer.', sourceDescription: 'Reviewed platform starter content.',
    items: [
      { code: '1', name: 'Connect a customer', description: 'Handle a new connection.', level: 1, parentCode: null, order: 10 },
      { code: '1.1', name: 'Issue a quote', description: 'Prepare a quote.', level: 2, parentCode: '1', order: 10 },
    ],
    sources: [{ citation: 'Reviewed customer journey', url: 'https://example.test/source', reviewedBy: 'Platform reviewer', reviewedAt: '2026-11-22' }],
    valueStreams: [{ code: 'connection', name: 'Getting connected', order: 10, stages: [
      { code: 'quoting', name: 'Quoting', order: 10, enables: ['Issue a quote'] },
    ] }],
  };

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    check(await service.from('capability_maps').insert({ id: baseId, sector, version: 1, status: 'draft',
      title: 'Original', summary: 'Original map', source_description: 'Reviewed original.' }));
    check(await service.from('capability_map_items').insert({ id: baseItemId, map_id: baseId, code: '1', parent_code: null,
      name: 'Connect a customer', description: 'Handle a new connection.', level: 1, item_order: 10 }));
    check(await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', baseId));
    check(await service.from('reference_capabilities').insert({ id: existingIdentityId, stable_key: `customer-connection-${sector.slice(-8)}` }));
    check(await service.from('reference_capability_revisions').insert({ capability_id: existingIdentityId, revision: 1,
      name: 'Connect a customer', definition: 'Manage a new customer connection.', status: 'published', published_at: new Date().toISOString() }));
  });
  afterAll(async () => {
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('reads the fixed published version before making a draft', async () => {
    const snapshot = await readReferenceMap(admin.client, {
      id: baseId, sector, version: 1, status: 'published', title: 'Original', published_at: null,
      item_count: 1, seeded_model_count: 0,
    });
    expect(snapshot.version).toBe(1);
    expect(snapshot.status).toBe('published');
    expect(snapshot.items.map((item) => item.name)).toEqual(['Connect a customer']);
    expect(snapshot.sourceDescription).toBe('Reviewed original.');
  });

  it('denies other authenticated callers, anon and direct writes', async () => {
    const unauthorized = await outside.client.schema('atlas').rpc('create_reference_map_draft', {
      p_sector: sector, p_version: 2, p_base_map_id: baseId, p_content: content,
    });
    expect(unauthorized.error).not.toBeNull();
    expect((await anon.schema('atlas').rpc('reference_map_issues', { p_content: content })).error).not.toBeNull();
    expect((await admin.client.from('reference_map_drafts').insert({ sector, version: 2, content,
      created_by: admin.id, updated_by: admin.id })).error).not.toBeNull();
    check(await outside.client.from('reference_map_drafts').select('id'));
    expect((await outside.client.from('reference_map_drafts').select('id')).data).toEqual([]);
    expect((await outside.client.schema('atlas').rpc('reference_map_inventory')).error).not.toBeNull();
    expect((await outside.client.schema('atlas').rpc('search_reference_capabilities', { p_query: 'customer' })).error).not.toBeNull();
  });

  it('saves with optimistic concurrency, validates, and publishes the whole version', async () => {
    draftId = await createReferenceMapDraft(admin.client, sector, 2, baseId, content);
    expect((await outside.client.schema('atlas').rpc('align_reference_map_draft_item', { p_id: draftId,
      p_expected_revision: 1, p_code: '1', p_choice: { kind: 'new', stableKey: 'injected', definition: 'Bad', reviewBasis: 'Bypass' } })).error).not.toBeNull();
    const first = await admin.client.from('reference_map_drafts').select('*').eq('id', draftId).single();
    check(first);
    expect(first.data?.edit_revision).toBe(1);
    const changed = { ...content, summary: 'Connection quotes and customer onboarding.' };
    const draft = { id: draftId, edit_revision: 1 } as ReferenceMapDraft;
    expect(await saveReferenceMapDraft(admin.client, draft, changed)).toBe(2);
    await expect(saveReferenceMapDraft(admin.client, draft, content)).rejects.toThrow(/changed elsewhere/);
    expect(await validateReferenceMap(admin.client, changed)).toEqual([]);
    expect((await admin.client.schema('atlas').rpc('reference_map_issues', { p_content: { ...changed, items: [] } })).data).toContain('At least one capability is required.');
    await expect(publishReferenceMapDraft(admin.client, { ...draft, edit_revision: 2 })).rejects.toThrow(/canonical identity/);
    const firstAlignmentRevision = await alignDraftItem(admin.client, { ...draft, edit_revision: 2 }, '1', {
      kind: 'existing', capabilityId: existingIdentityId, revision: 1, reviewBasis: 'Reviewed the same customer connection meaning.',
    });
    expect(firstAlignmentRevision).toBe(3);
    const second = await alignDraftItem(admin.client, { ...draft, edit_revision: 3 }, '1.1', {
      kind: 'new', stableKey: `issue-quote-${sector.slice(-8)}`, definition: 'Prepare a quote for a requested customer connection.',
      reviewBasis: 'This is a distinct quoting capability.',
    });
    expect(second).toBe(4);
    const publishedId = await publishReferenceMapDraft(admin.client, { ...draft, edit_revision: 4 });
    const result = await service.from('capability_maps').select('status,summary').eq('id', publishedId).single();
    check(result);
    expect(result.data).toMatchObject({ status: 'published', summary: changed.summary });
    const items = await service.from('capability_map_items').select('code,name').eq('map_id', publishedId);
    check(items);
    expect(items.data).toHaveLength(2);
    const stages = await service.from('capability_map_value_stream_enables').select('stage_code,capability_code').eq('map_id', publishedId);
    check(stages);
    expect(stages.data).toMatchObject([{ stage_code: 'quoting', capability_code: '1.1' }]);
    const publishedItems = await service.from('capability_map_items').select('id').eq('map_id', publishedId);
    check(publishedItems);
    const links = await service.from('reference_map_item_links').select('capability_id,map_item_id').in('map_item_id', (publishedItems.data as { id: string }[]).map((row) => row.id));
    check(links);
    expect(links.data).toHaveLength(2);
    expect(links.data?.some((link) => link.capability_id === existingIdentityId)).toBe(true);
    const old = await service.from('capability_map_items').select('name').eq('id', baseItemId).single();
    check(old);
    expect(old.data?.name).toBe('Connect a customer');
    expect((await service.from('capability_maps').select('status').eq('id', baseId).single()).data?.status).toBe('deprecated');
    await expect(saveReferenceMapDraft(admin.client, { ...draft, edit_revision: 4 }, content)).rejects.toThrow();
    await expect(publishReferenceMapDraft(admin.client, { ...draft, edit_revision: 4 })).rejects.toThrow();

    const nextDraftId = await createReferenceMapDraft(admin.client, sector, 3, publishedId, { ...changed, version: 3 });
    const carried = await admin.client.from('reference_map_draft_alignments').select('item_code,kind')
      .eq('draft_id', nextDraftId).order('item_code');
    check(carried);
    expect(carried.data).toMatchObject([{ item_code: '1', kind: 'existing' }, { item_code: '1.1', kind: 'existing' }]);
  });
});
