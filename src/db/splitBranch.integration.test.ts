/**
 * Integration tests for Sprint C2 (Prompt 7b), ADR-006's amendment:
 * `atlas.split_branch` (`20260911020000_split_branch.sql`) plus the
 * client-side closure computation (`src/db/split.ts`) against a real
 * local Supabase. Same "needs a running `supabase start`" limitation as
 * `src/db/repository.integration.test.ts`'s own module comment.
 *
 * Covers the C1 audit's own named invariant 4 ("the original branch after
 * a split still folds cleanly") directly, plus the closure's two
 * behaviours (pull-in, block) end to end through the real RPC — not just
 * the pure engine unit/property tests (`src/engine/splitClosure.test.ts`,
 * `.property.test.ts`), which never touch a database at all.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { foldFromGenesis } from '../engine/head';
import { createChangeBranch, getBranch, getMainBranch, listSplitBranches, resolveChangeLineage } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { buildCommitLoader } from './commitLoader';
import { commitToBranch } from './commits';
import { createModel } from './models';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';
import { mergeApprovedRequest } from './mergeRequests';
import { previewSplitClosure, splitAndMergeSubset } from './split';
import { getOrCreateManualSource } from './sources';

const env = loadEnv();
const service = createServiceRoleClient(env);

async function createSignedInUser(label: string): Promise<{ id: string; client: Client }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client: signIn };
}

function makeCapability(id: string, elementId: string, name: string, parentId: string | null, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'capability', name, parentId, attributes: {}, sourceId, confidence: 1 };
}
function makeSystem(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}
function makeSupports(id: string, relationshipId: string, fromElementId: string, toElementId: string, sourceId: string): Delta {
  return { kind: 'relationship.create', id, relationshipId, relationshipType: 'supports', fromElementId, toElementId, attributes: { role: 'secondary' }, sourceId, confidence: 1 };
}
function makeRetract(id: string, elementId: string, elementType: 'system' | 'capability', previousDeltaId: string, sourceId: string): Delta {
  return { kind: 'element.retract', id, elementId, elementType, previousDeltaId, sourceId, confidence: 1 };
}

describe('atlas.split_branch against a real local Supabase (Sprint C2, Prompt 7b)', () => {
  let alice: { id: string; client: Client };
  let orgId: string;
  let modelId: string;
  let sourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('splitbranch-alice');
    orgId = randomUUID();
    await createOrganisation(alice.client, { id: orgId, name: 'Split Branch Test Org', slug: `split-${orgId.slice(0, 8)}`, createdBy: alice.id });
    modelId = randomUUID();
    await createModel(alice.client, { id: modelId, orgId, name: 'Split Branch Test Model', slug: `split-model-${modelId.slice(0, 8)}`, createdBy: alice.id });
    const source = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    sourceId = source.id;
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(alice.id);
  });

  it('accepting a subset moves it to a new, merged branch; the remainder stays on the original, which still folds cleanly', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `split-basic-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'propose', mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const acceptedId = randomUUID();
    const remainderId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'two independent systems',
        body: null,
        deltas: [makeSystem(randomUUID(), acceptedId, 'Accepted System', sourceId), makeSystem(randomUUID(), remainderId, 'Remainder System', sourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });
    const branchAfterCommit = await getBranch(alice.client, branch.id);
    if (!branchAfterCommit) throw new Error('branch not found after commit');

    const splitResult = await splitAndMergeSubset(alice.client, {
      modelId,
      branch: branchAfterCommit,
      mainHeadCommitId: main.head_commit_id,
      requestedSubjectIds: new Set([acceptedId]),
      splitBranchName: `split-basic-${randomUUID().slice(0, 8)}`,
      splitBranchTitle: 'Split: Accepted System',
    });
    expect(splitResult.ok).toBe(true);
    if (!splitResult.ok) return;
    expect(splitResult.closure.accepted).toEqual(new Set([acceptedId]));
    expect(splitResult.splitBranch.split_from).toBe(branch.id);
    expect(splitResult.splitBranch.status).toBe('approved');

    const mergeResult = await mergeApprovedRequest(alice.client, modelId, splitResult.mergeRequestId, splitResult.splitBranch, splitResult.splitBranch.title ?? 'Split');
    expect(mergeResult).toMatchObject({ ok: true });

    // The accepted system is now on main; the remainder is not.
    const mainAfter = await getMainBranch(alice.client, modelId);
    if (!mainAfter?.head_commit_id) throw new Error('main branch not found after merge');
    const loader = await buildCommitLoader(alice.client, modelId);
    const mainHead = foldFromGenesis(mainAfter.head_commit_id, loader);
    expect(mainHead.elements.has(acceptedId)).toBe(true);
    expect(mainHead.elements.has(remainderId)).toBe(false);

    // ADR-006 amendment rule 1: the original branch's own status is
    // unchanged by a partial acceptance — never implicitly closed.
    const originalAfter = await getBranch(alice.client, branch.id);
    expect(originalAfter?.status).toBe(branchAfterCommit.status);

    // C1 audit invariant 4: the original branch — untouched, still
    // carrying every one of its own deltas including the one that's now
    // also on main via the split — still folds cleanly from genesis.
    const loaderAfter = await buildCommitLoader(alice.client, modelId);
    expect(() => {
      if (!originalAfter?.head_commit_id) throw new Error('original branch has no head');
      return foldFromGenesis(originalAfter.head_commit_id, loaderAfter);
    }).not.toThrow();

    // The change page's own lineage (ADR-006 amendment rule 3): the
    // original and its split, as one logical change.
    if (!originalAfter) throw new Error('original branch not found');
    const lineage = await resolveChangeLineage(alice.client, originalAfter);
    expect(lineage.original.id).toBe(branch.id);
    expect(lineage.splits.map((b) => b.id)).toContain(splitResult.splitBranch.id);
    const splits = await listSplitBranches(alice.client, branch.id);
    expect(splits.map((b) => b.id)).toContain(splitResult.splitBranch.id);
  });

  it('pull-in: accepting only a relationship pulls its own new endpoint in too, and both land on main', async () => {
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `split-pullin-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'propose', mainHeadCommitId: main.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const systemId = randomUUID();
    const capabilityId = randomUUID();
    const relationshipId = randomUUID();
    const commitResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'a system, a capability, and the supports edge between them',
        body: null,
        deltas: [makeSystem(randomUUID(), systemId, 'Pull-In System', sourceId), makeCapability(randomUUID(), capabilityId, 'Pull-In Capability', null, sourceId), makeSupports(randomUUID(), relationshipId, systemId, capabilityId, sourceId)],
      },
    });
    expect(commitResult).toMatchObject({ ok: true });
    const branchAfterCommit = await getBranch(alice.client, branch.id);
    if (!branchAfterCommit) throw new Error('branch not found after commit');

    // Only the relationship requested — both its endpoints are new on
    // this branch, so the closure must pull both in.
    const preview = await previewSplitClosure(alice.client, { modelId, branch: branchAfterCommit, mainHeadCommitId: main.head_commit_id, requestedSubjectIds: new Set([relationshipId]) });
    expect(preview.accepted).toEqual(new Set([relationshipId, systemId, capabilityId]));
    expect(preview.pulledIn).toEqual(new Set([systemId, capabilityId]));

    const splitResult = await splitAndMergeSubset(alice.client, {
      modelId,
      branch: branchAfterCommit,
      mainHeadCommitId: main.head_commit_id,
      requestedSubjectIds: new Set([relationshipId]),
      splitBranchName: `split-pullin-${randomUUID().slice(0, 8)}`,
      splitBranchTitle: 'Split: Pull-In System supports Pull-In Capability',
    });
    expect(splitResult.ok).toBe(true);
    if (!splitResult.ok) return;
    const mergeResult = await mergeApprovedRequest(alice.client, modelId, splitResult.mergeRequestId, splitResult.splitBranch, 'merge split-pullin');
    expect(mergeResult).toMatchObject({ ok: true });

    const mainAfter = await getMainBranch(alice.client, modelId);
    if (!mainAfter?.head_commit_id) throw new Error('main branch not found after merge');
    const loader = await buildCommitLoader(alice.client, modelId);
    const mainHead = foldFromGenesis(mainAfter.head_commit_id, loader);
    expect(mainHead.elements.has(systemId)).toBe(true);
    expect(mainHead.elements.has(capabilityId)).toBe(true);
    expect(mainHead.relationships.has(relationshipId)).toBe(true);
  });

  it('block: accepting a retract without the branch\'s own retraction of what still references it is refused — nothing to split, main is untouched', async () => {
    // Seed a capability and a supporting system directly onto main. `apply`'s
    // own C8 check (src/engine/deltas.ts) means a branch can only ever
    // *commit* a retract of the capability once every relationship
    // referencing it has already been retracted earlier in the same
    // branch — so this scenario retracts both, on the branch, in the only
    // order C8 allows. The closure test is then: requesting only the
    // capability's own retract for the split — without also requesting
    // the relationship's — must be refused, since splitting it off alone
    // would leave the relationship live and dangling in the result.
    const main = await getMainBranch(alice.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch not found');
    const preExistingCapabilityId = randomUUID();
    const preExistingSystemId = randomUUID();
    const preExistingRelationshipId = randomUUID();
    const seedResult = await commitToBranch(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'seed a capability with a supporting system',
        body: null,
        deltas: [
          makeCapability(randomUUID(), preExistingCapabilityId, 'Blocked Retract Capability', null, sourceId),
          makeSystem(randomUUID(), preExistingSystemId, 'Blocked Retract System', sourceId),
          makeSupports(randomUUID(), preExistingRelationshipId, preExistingSystemId, preExistingCapabilityId, sourceId),
        ],
      },
    });
    expect(seedResult).toMatchObject({ ok: true });

    const mainAfterSeed = await getMainBranch(alice.client, modelId);
    if (!mainAfterSeed?.head_commit_id) throw new Error('main branch not found after seed');
    const branch = await createChangeBranch(alice.client, { id: randomUUID(), orgId, modelId, name: `split-blocked-${randomUUID().slice(0, 8)}`, createdBy: alice.id, intent: 'propose', mainHeadCommitId: mainAfterSeed.head_commit_id });
    if (!branch.head_commit_id) throw new Error('branch has no head at creation');

    const loaderForRetract = await buildCommitLoader(alice.client, modelId);
    const branchHeadBeforeRetract = foldFromGenesis(branch.head_commit_id, loaderForRetract);
    const capabilityExistsDeltaId = branchHeadBeforeRetract.elements.get(preExistingCapabilityId)?.existsDeltaId;
    const relationshipExistsDeltaId = branchHeadBeforeRetract.relationships.get(preExistingRelationshipId)?.existsDeltaId;
    if (!capabilityExistsDeltaId || !relationshipExistsDeltaId) throw new Error('seeded rows missing an existsDeltaId');

    const retractResult = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: branch.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'retract the relationship, then the capability it supported',
        body: null,
        deltas: [
          { kind: 'relationship.retract', id: randomUUID(), relationshipId: preExistingRelationshipId, relationshipType: 'supports', previousDeltaId: relationshipExistsDeltaId, sourceId, confidence: 1 },
          makeRetract(randomUUID(), preExistingCapabilityId, 'capability', capabilityExistsDeltaId, sourceId),
        ],
      },
    });
    expect(retractResult).toMatchObject({ ok: true });
    const branchAfterRetract = await getBranch(alice.client, branch.id);
    if (!branchAfterRetract) throw new Error('branch not found after retract');

    // Requesting only the capability's own retract, not the relationship's.
    const preview = await previewSplitClosure(alice.client, { modelId, branch: branchAfterRetract, mainHeadCommitId: mainAfterSeed.head_commit_id, requestedSubjectIds: new Set([preExistingCapabilityId]) });
    expect(preview.accepted).toEqual(new Set());
    expect(preview.blocked).toEqual([{ subjectId: preExistingCapabilityId, dependentSubjectId: preExistingRelationshipId, dependentSubjectType: 'relationship', dependentIsPreExisting: true }]);

    const splitResult = await splitAndMergeSubset(alice.client, {
      modelId,
      branch: branchAfterRetract,
      mainHeadCommitId: mainAfterSeed.head_commit_id,
      requestedSubjectIds: new Set([preExistingCapabilityId]),
      splitBranchName: `split-blocked-${randomUUID().slice(0, 8)}`,
      splitBranchTitle: 'Split: retract Blocked Retract Capability',
    });
    expect(splitResult).toMatchObject({ ok: false, reason: 'nothing_accepted' });

    // Main is untouched — no split branch, no merge, nothing changed.
    const mainStillUnchanged = await getMainBranch(alice.client, modelId);
    expect(mainStillUnchanged?.head_commit_id).toBe(mainAfterSeed.head_commit_id);

    // Requesting *both* — the capability and the relationship that
    // depended on it — is not blocked: the split includes both, and main
    // ends up with neither.
    const bothPreview = await previewSplitClosure(alice.client, { modelId, branch: branchAfterRetract, mainHeadCommitId: mainAfterSeed.head_commit_id, requestedSubjectIds: new Set([preExistingCapabilityId, preExistingRelationshipId]) });
    expect(bothPreview.blocked).toEqual([]);
    expect(bothPreview.accepted).toEqual(new Set([preExistingCapabilityId, preExistingRelationshipId]));

    const bothSplitResult = await splitAndMergeSubset(alice.client, {
      modelId,
      branch: branchAfterRetract,
      mainHeadCommitId: mainAfterSeed.head_commit_id,
      requestedSubjectIds: new Set([preExistingCapabilityId, preExistingRelationshipId]),
      splitBranchName: `split-unblocked-${randomUUID().slice(0, 8)}`,
      splitBranchTitle: 'Split: retract both',
    });
    expect(bothSplitResult.ok).toBe(true);
    if (!bothSplitResult.ok) return;
    const bothMergeResult = await mergeApprovedRequest(alice.client, modelId, bothSplitResult.mergeRequestId, bothSplitResult.splitBranch, 'merge split-unblocked');
    expect(bothMergeResult).toMatchObject({ ok: true });

    const mainAfterBoth = await getMainBranch(alice.client, modelId);
    if (!mainAfterBoth?.head_commit_id) throw new Error('main branch not found after second merge');
    const loaderAfterBoth = await buildCommitLoader(alice.client, modelId);
    const mainHeadAfterBoth = foldFromGenesis(mainAfterBoth.head_commit_id, loaderAfterBoth);
    expect(mainHeadAfterBoth.elements.has(preExistingCapabilityId)).toBe(false);
    expect(mainHeadAfterBoth.relationships.has(preExistingRelationshipId)).toBe(false);
  });
});
