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
import { loadEnv } from './env';
import { createTag, listTagsForModel } from './tags';

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
  let modelId: string;
  let mainGenesisCommitId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('alice');
    bob = await createSignedInUser('bob');

    orgId = randomUUID();
    const { error: orgError } = await alice.client.from('organisations').insert({ id: orgId, name: 'Test Council', slug: `test-council-${orgId.slice(0, 8)}`, created_by: alice.id });
    if (orgError) throw new Error(`org setup: ${orgError.message}`);

    modelId = randomUUID();
    const { error: modelError } = await alice.client
      .from('models')
      .insert({ id: modelId, org_id: orgId, name: 'Test Landscape', slug: `test-landscape-${modelId.slice(0, 8)}`, schema_version: 1, created_by: alice.id });
    if (modelError) throw new Error(`model setup: ${modelError.message}`);

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
      orgId,
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
      createdBy: alice.id,
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
      orgId,
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: buildEnvelope('First commit'),
      createdBy: alice.id,
    });
    expect(first.ok).toBe(true);

    // Same expectedHeadCommitId as `first` used — but the branch has
    // already moved past it. This is exactly what a second browser tab, or
    // a stale in-memory head, would send.
    const second = await commitToBranch(alice.client, {
      orgId,
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: buildEnvelope('Second, conflicting commit'),
      createdBy: alice.id,
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
});
