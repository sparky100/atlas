import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { copySampleModel, listSampleModels } from './sampleModels';
import { listSampleModelsForAdmin, reinstateSampleModel, withdrawSampleModel } from './sampleModelAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);
const slug = `withdraw-${randomUUID().slice(0, 8)}`;

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `sample-withdraw-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);
  return { id: created.data.user.id, client };
}

describe('sample model withdrawal, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  let sampleId: string;

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    const grant = await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null });
    if (grant.error) throw new Error(grant.error.message);
    sampleId = randomUUID();
    const row = await service.from('sample_models').insert({
      id: sampleId, slug, version: 1, name: 'Withdrawable sample', description: 'A sample for the withdrawal test.',
      payload: { elementsHead: [{}], relationshipsHead: [], facts: [], sources: [], aliases: [] },
      published_by: admin.id,
    });
    if (row.error) throw new Error(row.error.message);
  });

  afterAll(async () => {
    await service.from('sample_model_withdrawal_events').delete().eq('slug', slug);
    await service.from('sample_models').delete().eq('slug', slug);
    await service.from('platform_admins').delete().eq('user_id', admin.id);
    for (const user of [admin, outside]) { await user.client.auth.signOut(); await service.auth.admin.deleteUser(user.id); }
  });

  it('hides a withdrawn sample from ordinary users and blocks copying it', async () => {
    await withdrawSampleModel(admin.client, slug, 'The sample contained outdated content.');
    const listedForOutside = (await listSampleModels(outside.client)).filter((sample) => sample.slug === slug);
    expect(listedForOutside).toEqual([]);
    const listedForAdmin = (await listSampleModels(admin.client)).filter((sample) => sample.slug === slug);
    expect(listedForAdmin).toEqual([]);

    const direct = await outside.client.from('sample_models').select('id').eq('id', sampleId);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    const copy = await copySampleModel(outside.client, {
      sample: { id: sampleId, slug, version: 1, name: 'Withdrawable sample', description: null },
      orgId: randomUUID(), name: 'Should not exist', slug: `copy-${slug}`, authorId: outside.id,
    });
    expect(copy.ok).toBe(false);
    expect(copy.ok ? '' : copy.message).toContain('no longer available');

    const anotherVersion = await admin.client.from('sample_models').insert({
      slug, version: 2, name: 'Withdrawable sample', description: 'Not while withdrawn.',
      payload: { elementsHead: [{}], relationshipsHead: [], facts: [], sources: [], aliases: [] },
      published_by: admin.id,
    });
    expect(anotherVersion.error).not.toBeNull();
  });

  it('shows platform admins the withdrawn state and reason', async () => {
    const rows = await listSampleModelsForAdmin(admin.client);
    expect(rows.find((row) => row.slug === slug)).toMatchObject({
      shared: false,
      withdrawnReason: 'The sample contained outdated content.',
    });
  });

  it('refuses withdrawal by anyone who is not a platform admin', async () => {
    const denied = await outside.client.schema('atlas').rpc('withdraw_sample_model', {
      p_slug: slug, p_reason: 'Not mine',
    });
    expect(denied.error).not.toBeNull();
  });

  it('shares the same slug again after reinstatement', async () => {
    await reinstateSampleModel(admin.client, slug, null);
    const seen = (await listSampleModels(outside.client)).filter((sample) => sample.slug === slug);
    expect(seen).toHaveLength(1);
    const rows = await listSampleModelsForAdmin(admin.client);
    expect(rows.find((row) => row.slug === slug)?.shared).toBe(true);
  });
});
