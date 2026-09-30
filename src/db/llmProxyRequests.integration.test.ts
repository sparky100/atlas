/**
 * E4 (ADR-014): `llm_proxy_requests` against a real local Supabase. Same
 * "this sandbox has no Docker route" limitation named throughout this
 * repo's other integration suites — written and reasoned through against
 * the real RLS/grant behaviour, not executed here.
 *
 * The edge function itself (`supabase/functions/llm-proxy`) is the only
 * writer, using the service-role key — there is no client-facing insert
 * path to exercise here, same reasoning `send-invite-email` has no
 * integration test of its own (docs/EDGE-FUNCTIONS.md's "what this sprint
 * could and couldn't verify" note). This file covers the schema/RLS layer
 * that function depends on: member-scoped select, no insert grant to
 * `authenticated` at all, and — the "no payload retention" design itself —
 * that no prompt/response column exists to retain one in.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { listLlmProxyUsage } from './llmProxyRequests';
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

describe('llm_proxy_requests against a real local Supabase', () => {
  let owner: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let olderRequestId: string;
  let newerRequestId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('llmproxy-owner');
    outsider = await createSignedInUser('llmproxy-outsider');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'LLM Proxy Test Org', slug: `llmproxy-${orgId.slice(0, 8)}`, createdBy: owner.id });

    // Simulates the edge function's own service-role writes — one 'ok', one
    // 'rate_limited', an hour apart, so ordering is unambiguous. Both rows
    // set `created_at` explicitly rather than letting the second one rely
    // on the column's own `default now()`: postgrest-js computes the union
    // of keys across a single array `.insert()` call and sends an explicit
    // `null` for any row that omits a key another row in the same call
    // supplies, which would violate this column's `not null` here instead
    // of ever reaching the database default.
    olderRequestId = randomUUID();
    newerRequestId = randomUUID();
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: seedError } = await service.from('llm_proxy_requests').insert([
      { id: olderRequestId, org_id: orgId, model: 'claude-opus-5', status: 'ok', input_tokens: 120, output_tokens: 40, latency_ms: 850, created_at: anHourAgo },
      { id: newerRequestId, org_id: orgId, model: 'claude-opus-5', status: 'rate_limited', input_tokens: null, output_tokens: null, latency_ms: 2, created_at: new Date().toISOString() },
    ]);
    if (seedError) throw new Error(`seed llm_proxy_requests: ${seedError.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('a member sees this org\'s own requests, reverse-chronological', async () => {
    const rows = await listLlmProxyUsage(owner.client, orgId);
    expect(rows.map((r) => r.id)).toEqual([newerRequestId, olderRequestId]);
    expect(rows.find((r) => r.id === olderRequestId)).toMatchObject({ status: 'ok', input_tokens: 120, output_tokens: 40 });
    expect(rows.find((r) => r.id === newerRequestId)).toMatchObject({ status: 'rate_limited', input_tokens: null, output_tokens: null });
  });

  it('llm_proxy_requests_select is member-scoped — a non-member sees nothing', async () => {
    expect(await listLlmProxyUsage(outsider.client, orgId)).toEqual([]);
  });

  it('an ordinary member cannot insert directly — the edge function\'s service-role key is the only writer', async () => {
    const { error } = await owner.client.from('llm_proxy_requests').insert({ id: randomUUID(), org_id: orgId, model: 'claude-opus-5', status: 'ok' });
    expect(error).not.toBeNull();
  });

  it('has no prompt/response column to retain a payload in — the "no payload retention" design is a real schema constraint, not just a convention the edge function happens to follow', async () => {
    const { error } = await service.from('llm_proxy_requests').select('prompt').eq('id', olderRequestId);
    expect(error?.message).toMatch(/column .*prompt.* does not exist/i);
  });
});
