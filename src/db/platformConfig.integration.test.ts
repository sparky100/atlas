/**
 * E4 follow-up (ADR-014): `platform_config` against a real local Supabase.
 * Same "this sandbox has no Docker route" limitation named throughout this
 * repo's other integration suites — written and reasoned through against
 * the real RLS/grant behaviour, not executed here.
 *
 * No client wrapper module exists for this table (`src/db/types.ts`'s own
 * `PlatformConfigRow` doc comment explains why) — `llm-proxy`'s own
 * `loadConfig` is the only reader, via a raw REST call under the
 * service-role key, not through the Supabase JS client at all. This file
 * exercises the RLS lockdown directly against both clients instead: an
 * ordinary authenticated member gets nothing (not even an empty array —
 * the point is no visibility, not an empty result set), the service role
 * can read and write freely.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createOrganisation } from './organisations';
import { loadEnv } from './env';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
  client: Client;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);

  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);

  return { id: created.user.id, email, client: signIn };
}

describe('platform_config against a real local Supabase', () => {
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('platformconfig-owner');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Platform Config Test Org', slug: `platformconfig-${orgId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  afterEach(async () => {
    await service.from('platform_config').delete().eq('key', 'llm');
  });

  it('an ordinary authenticated member gets refused on select — not an empty result, a real denial', async () => {
    const { error } = await owner.client.from('platform_config').select('*').eq('key', 'llm').maybeSingle();
    expect(error).not.toBeNull();
  });

  it('an ordinary authenticated member cannot insert or update', async () => {
    const { error: insertError } = await owner.client.from('platform_config').insert({ key: 'llm', value: { model: 'not-allowed' } });
    expect(insertError).not.toBeNull();

    await service.from('platform_config').insert({ key: 'llm', value: { model: 'claude-opus-5' } });
    const { error: updateError } = await owner.client.from('platform_config').update({ value: { model: 'also-not-allowed' } }).eq('key', 'llm');
    expect(updateError).not.toBeNull();
  });

  it('the service role can read and write freely — this is llm-proxy\'s own loadConfig path', async () => {
    const { error: insertError } = await service.from('platform_config').insert({ key: 'llm', value: { model: 'claude-opus-5', rateLimitPerHour: 50 } });
    expect(insertError).toBeNull();

    const { data, error: selectError } = await service.from('platform_config').select('*').eq('key', 'llm').maybeSingle();
    expect(selectError).toBeNull();
    expect(data).toMatchObject({ key: 'llm', value: { model: 'claude-opus-5', rateLimitPerHour: 50 } });
  });
});
