/**
 * `loadChangeSummariesForModel` resilience: a live report saw "Couldn't
 * load change summaries." on the Changes list keep recurring even after
 * the branch that first caused it was cancelled — cancelling a branch
 * doesn't rewrite its own already-committed history, and the batch loader
 * folded *every* branch handed to it (`ChangesView.tsx` passes the full,
 * unfiltered list, cancelled ones included) with no per-branch isolation:
 * one branch whose own history can't be replayed (a genuine, already-
 * committed V6 violation from before that gate existed, in the real case)
 * threw and took every other branch's summary down with it — contradicting
 * this same function's own doc comment ("a failed batch load degrades to
 * 'no summary' on every card rather than blocking the list itself").
 *
 * The bad branch here is built by inserting its commit/deltas directly via
 * the service-role client, bypassing `commitToBranch`'s own pre-flight V6
 * check — exactly how such a branch could only ever have come to exist
 * for real: from before that check shipped, or from any other path that
 * didn't run it. `commitToBranch` itself now correctly refuses to create
 * this shape (src/engine/deltas.ts's `checkNoDuplicateRelationship`), so a
 * legacy-shaped fixture is the only way to reproduce the scenario at all.
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
import { createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadChangeSummariesForModel } from './changeSummary';
import { loadEnv } from './env';
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

describe('loadChangeSummariesForModel resilience against a real local Supabase', () => {
  let owner: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;
  let mainHeadCommitId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('summaryresilience-owner');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Summary Resilience Test Org', slug: `summaryresilience-${orgId.slice(0, 8)}`, createdBy: owner.id });

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Summary Resilience Test Model', slug: `summaryresilience-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const manualSource = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    sourceId = manualSource.id;

    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    mainHeadCommitId = main.head_commit_id;

    // Two systems on main, for the bad branch's own duplicate `uses` edge below.
    const seedResult = await commitToBranch(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: mainHeadCommitId,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: mainHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'seed two systems',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), randomUUID(), 'System A', sourceId), makeCreateDelta(randomUUID(), randomUUID(), 'System B', sourceId)],
      },
    });
    if (!seedResult.ok) throw new Error(`seed commit: ${seedResult.message}`);
    const mainAfterSeed = await getMainBranch(owner.client, modelId);
    if (!mainAfterSeed) throw new Error('main branch missing after seed');
    mainHeadCommitId = mainAfterSeed.head_commit_id;
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('skips a branch whose own history already has a duplicate-relationship violation, without blanking every other branch’s summary', async () => {
    const systemAId = randomUUID();
    const systemBId = randomUUID();
    const createA = makeCreateDelta(randomUUID(), systemAId, 'Legacy System A', sourceId);
    const createB = makeCreateDelta(randomUUID(), systemBId, 'Legacy System B', sourceId);

    const badBranch = await createChangeBranch(owner.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `legacy-duplicate-${randomUUID().slice(0, 8)}`,
      createdBy: owner.id,
      intent: 'record',
      mainHeadCommitId,
    });

    // Inserted directly (service role) rather than via `commitToBranch`,
    // which now correctly refuses this shape at commit time
    // (`checkNoDuplicateRelationship`, src/engine/deltas.ts) — the only way
    // a branch like this could exist is from before that check shipped.
    const badCommitId = randomUUID();
    const { error: commitError } = await service.from('commits').insert({
      id: badCommitId,
      org_id: orgId,
      model_id: modelId,
      branch_id: badBranch.id,
      parent_commit_id: mainHeadCommitId,
      merged_branch_head_commit_id: null,
      kind: 'manual',
      title: 'legacy duplicate uses edge',
      body: null,
      author_id: owner.id,
      depth: 1,
    });
    if (commitError) throw new Error(`insert legacy commit: ${commitError.message}`);

    const rel1Id = randomUUID();
    const rel2Id = randomUUID();
    const { error: deltasError } = await service.from('deltas').insert([
      { id: createA.id, org_id: orgId, model_id: modelId, commit_id: badCommitId, seq: 0, kind: 'element_create', subject_id: systemAId, attribute: '$exists', element_type: 'system', name: 'Legacy System A', parent_id: null, value: { lifecycleStatus: 'active', isExternal: false }, source_id: sourceId, confidence: 1, created_by: owner.id },
      { id: createB.id, org_id: orgId, model_id: modelId, commit_id: badCommitId, seq: 1, kind: 'element_create', subject_id: systemBId, attribute: '$exists', element_type: 'system', name: 'Legacy System B', parent_id: null, value: { lifecycleStatus: 'active', isExternal: false }, source_id: sourceId, confidence: 1, created_by: owner.id },
      { id: randomUUID(), org_id: orgId, model_id: modelId, commit_id: badCommitId, seq: 2, kind: 'relationship_create', subject_id: rel1Id, attribute: '$exists', relationship_type: 'uses', from_element_id: systemAId, to_element_id: systemBId, value: {}, source_id: sourceId, confidence: 1, created_by: owner.id },
      { id: randomUUID(), org_id: orgId, model_id: modelId, commit_id: badCommitId, seq: 3, kind: 'relationship_create', subject_id: rel2Id, attribute: '$exists', relationship_type: 'uses', from_element_id: systemAId, to_element_id: systemBId, value: {}, source_id: sourceId, confidence: 1, created_by: owner.id },
    ]);
    if (deltasError) throw new Error(`insert legacy deltas: ${deltasError.message}`);

    const { error: branchUpdateError } = await service.from('branches').update({ head_commit_id: badCommitId }).eq('id', badBranch.id);
    if (branchUpdateError) throw new Error(`point bad branch at legacy commit: ${branchUpdateError.message}`);
    const badBranchRow = await getBranch(owner.client, badBranch.id);
    if (!badBranchRow) throw new Error('bad branch missing after update');

    // A perfectly healthy second branch — its own summary must still come
    // back even though the bad branch above is in the same batch call.
    const goodBranch = await createChangeBranch(owner.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `healthy-${randomUUID().slice(0, 8)}`,
      createdBy: owner.id,
      intent: 'propose',
      mainHeadCommitId,
    });
    const goodResult = await commitToBranch(owner.client, {
      modelId,
      branchId: goodBranch.id,
      expectedHeadCommitId: mainHeadCommitId,
      envelope: {
        id: randomUUID(),
        branchId: goodBranch.id,
        parentCommitId: mainHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'a perfectly ordinary change',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), randomUUID(), 'Northgate', sourceId)],
      },
    });
    if (!goodResult.ok) throw new Error(`commitToBranch (good branch): ${goodResult.message}`);
    const goodBranchRow = await getBranch(owner.client, goodBranch.id);
    if (!goodBranchRow) throw new Error('good branch missing');

    const summaries = await loadChangeSummariesForModel(owner.client, modelId, [badBranchRow, goodBranchRow]);
    expect(summaries.has(badBranchRow.id)).toBe(false);
    expect(summaries.has(goodBranchRow.id)).toBe(true);
    expect(summaries.get(goodBranchRow.id)?.description).toContain('Northgate');
  });
});
