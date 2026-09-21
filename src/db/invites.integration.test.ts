/**
 * Sprint 7j item 4: invite-by-email against a real local Supabase. Same
 * "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/RPC/trigger behaviour, not
 * executed here.
 *
 * Covers both consumption paths `20260911060000_invites.sql`'s own module
 * comment names: the `auth.users`-insert trigger (a fresh signup with the
 * invited email) and `atlas.consume_my_invites` (an email that already had
 * an account before the invite existed — the gap the trigger alone can't
 * close, closed instead by `AuthProvider.tsx` calling this RPC on every
 * sign-in).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { consumeMyInvites, createInvite, listInvites, revokeInvite } from './invites';
import { createOrganisation, getMyMembership } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
  client: Client;
}

async function createSignedInUser(label: string, email?: string): Promise<TestUser> {
  const resolvedEmail = email ?? `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email: resolvedEmail, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);

  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email: resolvedEmail, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);

  return { id: created.user.id, email: resolvedEmail, client: signIn };
}

describe('invite by email against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('invites-owner');
    architect = await createSignedInUser('invites-architect');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Invites Test Org', slug: `invites-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (memberError) throw new Error(`add architect: ${memberError.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('an owner can invite; the email is normalised to lowercase', async () => {
    const email = `New-Person-${randomUUID().slice(0, 8)}@Example.test`;
    const result = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'contributor', invitedBy: owner.id });
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.invite.email).toBe(email.toLowerCase());
    expect(result.invite.consumed_at).toBeNull();
  });

  it('an architect cannot invite (invites_insert RLS is owner-only)', async () => {
    await expect(createInvite(architect.client, { id: randomUUID(), orgId, email: `nope-${randomUUID()}@example.test`, role: 'viewer', invitedBy: architect.id })).rejects.toThrow();
  });

  it('a second invite to an already-pending email returns already_pending rather than a raw conflict', async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@example.test`;
    const first = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'viewer', invitedBy: owner.id });
    expect(first.status).toBe('created');

    const second = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'architect', invitedBy: owner.id });
    expect(second).toEqual({ status: 'already_pending' });
  });

  it('a fresh signup with the invited email is consumed automatically by the auth.users trigger', async () => {
    const email = `freshsignup-${randomUUID().slice(0, 8)}@example.test`;
    const created = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'contributor', invitedBy: owner.id });
    expect(created.status).toBe('created');

    const invitee = await createSignedInUser('invites-freshsignup', email);

    const membership = await getMyMembership(invitee.client, orgId, invitee.id);
    expect(membership?.role).toBe('contributor');

    const invites = await listInvites(owner.client, orgId);
    const consumed = invites.find((i) => i.email === email.toLowerCase());
    expect(consumed?.consumed_at).not.toBeNull();
    expect(consumed?.consumed_by).toBe(invitee.id);
  });

  it('an email that already had an account before the invite is consumed by atlas.consume_my_invites at sign-in, not automatically', async () => {
    const invitee = await createSignedInUser('invites-existingaccount');

    // No invite existed at signup — nothing to consume yet, and no
    // membership yet either.
    expect(await getMyMembership(invitee.client, orgId, invitee.id)).toBeNull();

    const created = await createInvite(owner.client, { id: randomUUID(), orgId, email: invitee.email, role: 'viewer', invitedBy: owner.id });
    expect(created.status).toBe('created');

    // Still nothing — the auth.users insert trigger already fired, long
    // before this invite existed, and never fires again for this user.
    expect(await getMyMembership(invitee.client, orgId, invitee.id)).toBeNull();

    // AuthProvider.tsx's own sign-in hook calls exactly this, on every
    // 'SIGNED_IN' event — this is that call.
    await consumeMyInvites(invitee.client);

    const membership = await getMyMembership(invitee.client, orgId, invitee.id);
    expect(membership?.role).toBe('viewer');

    const invites = await listInvites(owner.client, orgId);
    const consumed = invites.find((i) => i.email === invitee.email.toLowerCase());
    expect(consumed?.consumed_at).not.toBeNull();
  });

  it('an owner can revoke a pending invite; a non-owner cannot', async () => {
    const email = `revoke-${randomUUID().slice(0, 8)}@example.test`;
    const created = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'viewer', invitedBy: owner.id });
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('unreachable');

    await expect(revokeInvite(architect.client, created.invite.id)).rejects.toThrow();

    await revokeInvite(owner.client, created.invite.id);
    const invites = await listInvites(owner.client, orgId);
    expect(invites.find((i) => i.id === created.invite.id)).toBeUndefined();

    // Revoked, not just refused — the same email can be invited again
    // immediately (the partial unique index only blocks a second
    // *pending* invite, and revoking deletes the row outright).
    const reinvited = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'contributor', invitedBy: owner.id });
    expect(reinvited.status).toBe('created');
  });

  // Sprint F7 item 1: `last_sent_at` (20260914030000_invites_last_sent_at.sql)
  // is the one column any client write to `invites` can ever reach — the
  // edge function itself writes it via this exact same RLS-scoped update,
  // not a service-role bypass, so this is the real authorization boundary
  // for "who can mark an invite as sent."
  it('an owner can set last_sent_at directly; a non-owner cannot; no other column is writable', async () => {
    const email = `lastsent-${randomUUID().slice(0, 8)}@example.test`;
    const created = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'viewer', invitedBy: owner.id });
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('unreachable');

    const now = new Date().toISOString();
    const { error: ownerError } = await owner.client.from('invites').update({ last_sent_at: now }).eq('id', created.invite.id);
    expect(ownerError).toBeNull();

    const invites = await listInvites(owner.client, orgId);
    // Postgres returns a `timestamptz` as `...+00:00`, not the `Z`-suffixed
    // ISO form `now` itself is — compare as `Date`s, not exact strings.
    const roundTripped = invites.find((i) => i.id === created.invite.id)?.last_sent_at;
    expect(roundTripped).not.toBeUndefined();
    expect(new Date(roundTripped ?? '').getTime()).toBe(new Date(now).getTime());

    // A blocked update under RLS isn't a Postgres error on its own — the
    // `using` clause just excludes the row from the scan, so a bare
    // `.update()` reports an ordinary zero-row success. `.select('id')`
    // turns "matched nothing" into a real, checkable result (found live:
    // this assertion was passing against a silent no-op, not a rejection).
    const { data: architectData, error: architectError } = await architect.client.from('invites').update({ last_sent_at: now }).eq('id', created.invite.id).select('id');
    expect(architectError !== null || (architectData?.length ?? 0) === 0).toBe(true);

    // The column grant is `last_sent_at` only — `role` (any other column)
    // must still be unwritable, matching this table's "never by a client
    // write" stance for everything except this one field.
    const { data: roleWriteData, error: roleWriteError } = await owner.client.from('invites').update({ role: 'owner' }).eq('id', created.invite.id).select('id');
    expect(roleWriteError !== null || (roleWriteData?.length ?? 0) === 0).toBe(true);
  });
});
