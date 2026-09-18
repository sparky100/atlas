/**
 * Round-trip coverage for the `listInFlightBranchesTouchingSubjects` fix
 * (SPEC §6.7 / CLAUDE.md rule 8): a live report hit
 * `listInFlightBranchesTouchingSubjects: .in('subject_id', ...) called with
 * 89 values, over the 50-value limit` — a real change branch touching that
 * many elements made the change page's "other open changes" lookup throw,
 * surfacing as "Couldn't load this change's summary." in the UI
 * (`useChangeSummary.ts`). `listInFlightBranchesTouchingSubjects` (`./
 * elements.ts`) no longer puts `subjectIds` in an `.in()` filter at all —
 * it queries the model scope and narrows in memory, same shape as
 * `src/db/landscape.ts`'s `listLandscapeEdges`/`listSupportsEdgesForSystems`.
 *
 * Same sandbox limitation as every other `*.integration.test.ts` in this
 * repo (see `repository.integration.test.ts`'s own header comment): this
 * sandbox's network policy blocks the Docker Hub pulls `supabase start`
 * needs, so this could not be run here — `pnpm db:start` then
 * `pnpm test:integration` locally is what actually proves it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { createChangeBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { listInFlightBranchesTouchingSubjects } from './elements';
import { createModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';

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

function makeCreateDelta(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}

describe('listInFlightBranchesTouchingSubjects against a real local Supabase', () => {
  let owner: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;
  let mainHeadCommitId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('touchsubjects-owner');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Touch Subjects Test Org', slug: `touchsubjects-${orgId.slice(0, 8)}`, createdBy: owner.id });

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Touch Subjects Test Model', slug: `touchsubjects-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const manualSource = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    sourceId = manualSource.id;

    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    mainHeadCommitId = main.head_commit_id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('does not throw over the 50-subject `.in()` limit, and still finds another open change sharing one subject', async () => {
    // 60 subjects on one branch — comfortably over the 50-value limit that
    // broke on a real 89-subject change.
    const sharedElementId = randomUUID();
    const branchAElementIds = Array.from({ length: 59 }, () => randomUUID()).concat(sharedElementId);

    const branchA = await createChangeBranch(owner.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `branch-a-${randomUUID().slice(0, 8)}`,
      createdBy: owner.id,
      intent: 'propose',
      mainHeadCommitId,
    });
    const branchAResult = await commitToBranch(owner.client, {
      modelId,
      branchId: branchA.id,
      expectedHeadCommitId: mainHeadCommitId,
      envelope: {
        id: randomUUID(),
        branchId: branchA.id,
        parentCommitId: mainHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'touch 60 subjects',
        body: null,
        deltas: branchAElementIds.map((elementId, i) => makeCreateDelta(randomUUID(), elementId, `Branch A System ${String(i)}`, sourceId)),
      },
    });
    if (!branchAResult.ok) throw new Error(`commitToBranch (branch A): ${branchAResult.message}`);

    // A second, independent open change that happens to touch one of the
    // same subject ids (`sharedElementId`) — the "other open changes
    // touching the same elements" this query exists to find.
    const branchB = await createChangeBranch(owner.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `branch-b-${randomUUID().slice(0, 8)}`,
      createdBy: owner.id,
      intent: 'propose',
      mainHeadCommitId,
    });
    const branchBResult = await commitToBranch(owner.client, {
      modelId,
      branchId: branchB.id,
      expectedHeadCommitId: mainHeadCommitId,
      envelope: {
        id: randomUUID(),
        branchId: branchB.id,
        parentCommitId: mainHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'touch the shared subject too',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), sharedElementId, 'Branch B System', sourceId)],
      },
    });
    if (!branchBResult.ok) throw new Error(`commitToBranch (branch B): ${branchBResult.message}`);

    const found = await listInFlightBranchesTouchingSubjects(owner.client, modelId, branchAElementIds, branchA.id);
    expect(found.map((b) => b.id)).toEqual([branchB.id]);
  });
});
