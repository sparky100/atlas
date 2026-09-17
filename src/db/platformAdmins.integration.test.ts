/**
 * Platform admin (Atlas's first cross-org role) against a real local
 * Supabase. Same "this sandbox has no Docker route" limitation named
 * throughout this repo's other integration suites — written and reasoned
 * through against the real RLS behaviour, not executed here.
 *
 * There is no client-facing grant path — becoming a platform admin is a
 * service-role/SQL insert only (`docs/PLATFORM-ADMIN.md`), so this file
 * seeds that directly via the service client, then exercises the
 * self-row-only select policy `isPlatformAdmin` depends on.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { isPlatformAdmin } from './platformAdmins';
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

describe('platform_admins against a real local Supabase', () => {
  let admin: TestUser;
  let ordinaryUser: TestUser;

  beforeAll(async () => {
    admin = await createSignedInUser('platformadmins-admin');
    ordinaryUser = await createSignedInUser('platformadmins-ordinary');

    const { error } = await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null });
    if (error) throw new Error(`seed platform_admins: ${error.message}`);
  });

  afterAll(async () => {
    await service.from('platform_admins').delete().eq('user_id', admin.id);
  });

  it('a never-granted user is not a platform admin', async () => {
    expect(await isPlatformAdmin(ordinaryUser.client, ordinaryUser.id)).toBe(false);
  });

  it('a service-role-granted user reads their own admin status as true', async () => {
    expect(await isPlatformAdmin(admin.client, admin.id)).toBe(true);
  });

  it('platform_admins_select_self is self-row-only — one user cannot see whether another is a platform admin', async () => {
    // ordinaryUser's own session querying admin's row directly: RLS means
    // this returns no row at all (not an error, not the real value) —
    // isPlatformAdmin(ordinaryUser.client, admin.id) would read as "false"
    // for reasons that have nothing to do with admin.id's real status.
    const { data, error } = await ordinaryUser.client.from('platform_admins').select('user_id').eq('user_id', admin.id).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
