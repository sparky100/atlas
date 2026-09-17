/**
 * `atlas.get_platform_llm_config`/`atlas.set_platform_llm_config` against a
 * real local Supabase. Same "this sandbox has no Docker route" limitation
 * named throughout this repo's other integration suites — written and
 * reasoned through against the real RLS/RPC behaviour, not executed here.
 *
 * `platform_config` itself has no RLS policy at all (`20260917020000_platform_config.sql`)
 * — these two RPCs are the only client-reachable path into it besides the
 * `llm-proxy` edge function's own service-role client, so this file
 * exercises the RPCs directly rather than the table.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { getLlmProxyConfig, setLlmProxyConfig } from './llmProxyConfig';
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

describe('llm-proxy platform-admin RPCs against a real local Supabase', () => {
  let admin: TestUser;
  let ordinaryUser: TestUser;

  beforeAll(async () => {
    admin = await createSignedInUser('llmproxyconfig-admin');
    ordinaryUser = await createSignedInUser('llmproxyconfig-ordinary');

    const { error } = await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null });
    if (error) throw new Error(`seed platform_admins: ${error.message}`);
  });

  afterAll(async () => {
    await service.from('platform_admins').delete().eq('user_id', admin.id);
  });

  afterEach(async () => {
    await service.from('platform_config').delete().eq('key', 'llm');
  });

  it('a non-admin is refused on both get and set', async () => {
    const getResult = await getLlmProxyConfig(ordinaryUser.client);
    expect(getResult.status).toBe('error');

    const setResult = await setLlmProxyConfig(ordinaryUser.client, { model: 'claude-opus-5', rateLimitPerHour: 50 });
    expect(setResult.status).toBe('error');
  });

  it('an admin can set then get, and the raw API key never comes back', async () => {
    const setResult = await setLlmProxyConfig(admin.client, { model: 'claude-opus-5', rateLimitPerHour: 75, apiKey: 'sk-ant-test-key' });
    expect(setResult.status).toBe('ok');

    const getResult = await getLlmProxyConfig(admin.client);
    expect(getResult).toEqual({ status: 'ok', config: { model: 'claude-opus-5', rateLimitPerHour: 75, hasApiKey: true } });
  });

  it('omitting apiKey on a later set preserves the previously-set key (verified by peeking at the raw row with the service client — the app itself never does this)', async () => {
    await setLlmProxyConfig(admin.client, { model: 'claude-opus-5', rateLimitPerHour: 75, apiKey: 'sk-ant-original' });
    await setLlmProxyConfig(admin.client, { model: 'claude-sonnet-5', rateLimitPerHour: 90 });

    const { data } = await service.from('platform_config').select('value').eq('key', 'llm').maybeSingle();
    expect(data).toMatchObject({ value: { model: 'claude-sonnet-5', rateLimitPerHour: 90, apiKey: 'sk-ant-original' } });

    const getResult = await getLlmProxyConfig(admin.client);
    expect(getResult).toEqual({ status: 'ok', config: { model: 'claude-sonnet-5', rateLimitPerHour: 90, hasApiKey: true } });
  });

  it('clearApiKey removes a previously-set key entirely', async () => {
    await setLlmProxyConfig(admin.client, { model: 'claude-opus-5', rateLimitPerHour: 75, apiKey: 'sk-ant-original' });
    await setLlmProxyConfig(admin.client, { model: 'claude-opus-5', rateLimitPerHour: 75, clearApiKey: true });

    const getResult = await getLlmProxyConfig(admin.client);
    expect(getResult).toEqual({ status: 'ok', config: { model: 'claude-opus-5', rateLimitPerHour: 75, hasApiKey: false } });

    const { data } = await service.from('platform_config').select('value').eq('key', 'llm').maybeSingle();
    expect(data?.value).not.toHaveProperty('apiKey');
  });

  it('get returns nulls and hasApiKey:false when no override row exists at all', async () => {
    const getResult = await getLlmProxyConfig(admin.client);
    expect(getResult).toEqual({ status: 'ok', config: { model: null, rateLimitPerHour: null, hasApiKey: false } });
  });

  it('rejects an empty model and a non-positive rate limit', async () => {
    expect((await setLlmProxyConfig(admin.client, { model: '', rateLimitPerHour: 50 })).status).toBe('error');
    expect((await setLlmProxyConfig(admin.client, { model: 'claude-opus-5', rateLimitPerHour: 0 })).status).toBe('error');
  });
});
