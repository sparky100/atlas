/**
 * Integration tests against a local Supabase (`pnpm db:start` first, or the
 * CI "database" job, which starts one automatically — see
 * .github/workflows/ci.yml). Exercises the real auth flow real users go
 * through: a service-role client creates test accounts, each signs in for
 * real (password auth), and every subsequent request goes through RLS
 * exactly as a production request would — no session shortcuts.
 *
 * This file could not be run inside the authoring sandbox: this sandbox's
 * network policy blocks the Docker Hub pulls `supabase start` needs (see
 * README.md's setup notes and Sprint F1 step 1's summary), so there is no
 * running GoTrue/PostgREST to hit here. The underlying SQL this test
 * depends on — the branch-head compare-and-swap, the
 * atlas.guard_branch_head_advance trigger, RLS on every table touched —
 * was separately rehearsed by hand against a plain local Postgres with a
 * minimal auth shim (the same technique used for every prior migration in
 * this sprint). This file is what actually proves the real thing end to
 * end, starting with the first CI run on this branch.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { createChangeBranch, getBranch, getMainBranch, listBranchesForModel } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { createModel, getModelBySlug, listModelsForOrg } from './models';
import { loadEnv } from './env';
import { createOrganisation, getMyMembership, getOrganisationBySlug, listOrganisationsForUser } from './organisations';
import { createTag, listTagsForModel } from './tags';
import { getUserPreferences, upsertUserPreferences } from './userPreferences';

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

function makeCreateDelta(id: string, elementId: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'manual', confidence: 1 };
}

describe('repository layer against a real local Supabase', () => {
  let alice: TestUser;
  let bob: TestUser;
  let orgId: string;
  let orgSlug: string;
  let modelId: string;
  let modelSlug: string;
  let mainGenesisCommitId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('alice');
    bob = await createSignedInUser('bob');

    orgId = randomUUID();
    orgSlug = `test-council-${orgId.slice(0, 8)}`;
    // Through src/db/organisations.ts, not a raw insert — Sprint U1 step 2's
    // repository layer is exactly what real app code calls.
    await createOrganisation(alice.client, { id: orgId, name: 'Test Council', slug: orgSlug, createdBy: alice.id });

    modelId = randomUUID();
    modelSlug = `test-landscape-${modelId.slice(0, 8)}`;
    await createModel(alice.client, { id: modelId, orgId, name: 'Test Landscape', slug: modelSlug, createdBy: alice.id });

    // Bootstrap main's genesis commit as service_role — standing in for the
    // not-yet-built atlas.seed_from_map (Sprint F1's src/engine covers
    // fold/merge; actually writing main's first commit is future work, per
    // this file's own module comment and the note in Sprint F1 step 2).
    const main = await getMainBranch(service, modelId);
    if (!main) throw new Error('main branch was not auto-created');
    mainGenesisCommitId = randomUUID();
    const { error: genesisError } = await service
      .from('commits')
      .insert({ id: mainGenesisCommitId, org_id: orgId, model_id: modelId, branch_id: main.id, parent_commit_id: null, kind: 'template_seed', message: 'seed', author_id: alice.id, depth: 0 });
    if (genesisError) throw new Error(`genesis commit: ${genesisError.message}`);
    const { error: headError } = await service.from('branches').update({ head_commit_id: mainGenesisCommitId }).eq('id', main.id);
    if (headError) throw new Error(`advancing main head: ${headError.message}`);
  });

  afterAll(async () => {
    // Fresh CI databases don't need this, but a developer re-running
    // against a persistent local `supabase start` does. If beforeAll threw
    // before assigning alice/bob, that failure is already the one that
    // matters; this is best-effort cleanup, not itself under test.
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(alice.id);
    await service.auth.admin.deleteUser(bob.id);
  });

  it("alice becomes the organisation's owner automatically", async () => {
    const { data, error } = await alice.client.from('members').select('role').eq('org_id', orgId).eq('user_id', alice.id).single();
    expect(error).toBeNull();
    expect(data?.role).toBe('owner');
  });

  it('bob (not a member) sees none of it', async () => {
    expect(await getBranch(bob.client, mainGenesisCommitId)).toBeNull();
    expect(await listBranchesForModel(bob.client, modelId)).toEqual([]);
  });

  it('alice forks a change branch and commits to it successfully', async () => {
    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: 'add-a-system',
      createdBy: alice.id,
      mainHeadCommitId: mainGenesisCommitId,
    });
    expect(branch.status).toBe('draft');
    expect(branch.head_commit_id).toBe(mainGenesisCommitId);

    const elementId = randomUUID();
    const result = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: mainGenesisCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        message: 'add Housing Options',
        authorId: alice.id,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Housing Options')],
      },
    });
    expect(result).toMatchObject({ ok: true });

    const updated = await getBranch(alice.client, branch.id);
    expect(updated?.head_commit_id).toBe(result.ok ? result.commitId : undefined);
  });

  it('a second commit against the SAME stale expected head loses the race (optimistic concurrency)', async () => {
    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: 'concurrency-check',
      createdBy: alice.id,
      mainHeadCommitId: mainGenesisCommitId,
    });

    const buildEnvelope = (name: string) => ({
      id: randomUUID(),
      branchId: branch.id,
      parentCommitId: mainGenesisCommitId,
      mergedBranchHeadCommitId: null,
      kind: 'manual' as const,
      message: name,
      authorId: alice.id,
      deltas: [makeCreateDelta(randomUUID(), randomUUID(), name)],
    });

    const first = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: buildEnvelope('First commit'),
    });
    expect(first.ok).toBe(true);

    // Same expectedHeadCommitId as `first` used — but the branch has
    // already moved past it. This is exactly what a second browser tab, or
    // a stale in-memory head, would send.
    const second = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: buildEnvelope('Second, conflicting commit'),
    });
    expect(second).toMatchObject({ ok: false, reason: 'conflict' });

    // The branch head reflects only the winner.
    const finalBranch = await getBranch(alice.client, branch.id);
    expect(finalBranch?.head_commit_id).toBe(first.ok ? first.commitId : undefined);
  });

  it('alice tags the main genesis commit; bob still cannot see it', async () => {
    const tag = await createTag(alice.client, { id: randomUUID(), orgId, modelId, name: 'v1', commitId: mainGenesisCommitId, createdBy: alice.id });
    expect(tag.commit_id).toBe(mainGenesisCommitId);
    expect(await listTagsForModel(bob.client, modelId)).toEqual([]);
  });

  // Sprint U1 step 2: organisations/models repository, the org switcher and
  // model list's actual data source.
  it('alice lists her own organisation and resolves it by slug; bob sees neither', async () => {
    const aliceOrgs = await listOrganisationsForUser(alice.client);
    expect(aliceOrgs.map((o) => o.id)).toContain(orgId);
    expect(await getOrganisationBySlug(alice.client, orgSlug)).toMatchObject({ id: orgId });

    const bobOrgs = await listOrganisationsForUser(bob.client);
    expect(bobOrgs.map((o) => o.id)).not.toContain(orgId);
    expect(await getOrganisationBySlug(bob.client, orgSlug)).toBeNull();
  });

  it('alice lists her model and resolves it by slug; bob sees neither', async () => {
    const aliceModels = await listModelsForOrg(alice.client, orgId);
    expect(aliceModels.map((m) => m.id)).toContain(modelId);
    expect(await getModelBySlug(alice.client, orgId, modelSlug)).toMatchObject({ id: modelId });

    // Bob isn't a member, so RLS hides the org's models from him entirely —
    // listModelsForOrg(bob.client, orgId) returns [], not an error.
    expect(await listModelsForOrg(bob.client, orgId)).toEqual([]);
    expect(await getModelBySlug(bob.client, orgId, modelSlug)).toBeNull();
  });

  it("a contributor cannot create a model (mirrors models_insert's RLS, which is the real gate)", async () => {
    // Promote bob to contributor on alice's org so this actually exercises
    // "wrong role", not "not a member at all" (already covered above).
    const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    if (inviteError) throw new Error(`inviting bob as contributor: ${inviteError.message}`);

    await expect(createModel(bob.client, { id: randomUUID(), orgId, name: 'Should not exist', slug: `nope-${randomUUID().slice(0, 8)}`, createdBy: bob.id })).rejects.toThrow();

    const { error: removeError } = await alice.client.from('members').delete().eq('org_id', orgId).eq('user_id', bob.id);
    if (removeError) throw new Error(`removing bob: ${removeError.message}`);
  });

  it("alice's own membership row reports her role; a non-member's lookup finds nothing", async () => {
    const aliceMembership = await getMyMembership(alice.client, orgId, alice.id);
    expect(aliceMembership?.role).toBe('owner');
    expect(await getMyMembership(bob.client, orgId, bob.id)).toBeNull();
  });

  // Sprint U1 step 2a: user_preferences.
  describe('user_preferences', () => {
    it('has no row until the first change (SPEC §3.2)', async () => {
      expect(await getUserPreferences(alice.client, alice.id)).toBeNull();
    });

    it('is created by the first upsert, and updated by the next one', async () => {
      const created = await upsertUserPreferences(alice.client, { userId: alice.id, theme: 'dark' });
      expect(created).toMatchObject({ user_id: alice.id, theme: 'dark', density: 'comfortable', home_mode: 'director' });

      const updated = await upsertUserPreferences(alice.client, { userId: alice.id, density: 'compact' });
      // theme survives the second upsert untouched — this is a merge, not a replace.
      expect(updated).toMatchObject({ user_id: alice.id, theme: 'dark', density: 'compact' });
    });

    it("bob cannot read alice's preferences, and cannot write a row under her id (RLS is user-scoped, not org-scoped)", async () => {
      expect(await getUserPreferences(bob.client, alice.id)).toBeNull();
      await expect(upsertUserPreferences(bob.client, { userId: alice.id, theme: 'light' })).rejects.toThrow();
    });
  });
});
