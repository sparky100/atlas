/**
 * Sprint 7j item 1: archive/restore/delete against a real local Supabase.
 * Same "this sandbox has no Docker route" limitation named in
 * repository.integration.test.ts's own module comment — written and
 * reasoned through against the real RLS/RPC behaviour, not executed here.
 *
 * `atlas.delete_model`'s own migration comment has the full cascade-
 * ordering reasoning (self-referencing FKs nulled first, leaves deleted
 * before the tables they reference) — this test seeds real content across
 * most of that graph (a commit with deltas, a comment, a tag) specifically
 * so a wrong deletion order would surface here as a foreign-key violation,
 * not pass silently on an empty model.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import { createChangeBranch, getMainBranch } from './branches';
import { insertCaptureJob } from './captureJobs';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { commitToBranch } from './commits';
import { loadEnv } from './env';
import { archiveModel, createModel, deleteModel, getModelById, restoreModel, updateModel } from './models';
import { createOrganisation } from './organisations';
import { getOrCreateManualSource } from './sources';
import { createTag } from './tags';

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

describe('model archive/restore/delete against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('modelarchive-owner');
    architect = await createSignedInUser('modelarchive-architect');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Model Archive Test Org', slug: `modelarchive-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (memberError) throw new Error(`add architect: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Model Archive Test Model', slug: `modelarchive-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    // Best-effort — a local Supabase reset (pnpm db:reset) is the real
    // cleanup between full test runs; this just avoids leaving the org
    // behind for a test that runs archive-but-not-delete paths.
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('an architect can archive; only an owner can restore', async () => {
    const archived = await archiveModel(architect.client, modelId);
    expect(archived.archived_at).not.toBeNull();

    await expect(restoreModel(architect.client, modelId)).rejects.toThrow(/only an owner may restore/);

    const restored = await restoreModel(owner.client, modelId);
    expect(restored.archived_at).toBeNull();
  });

  it('rename/slug/description round-trip through updateModel, never touching archived_at', async () => {
    const updated = await updateModel(owner.client, modelId, { name: 'Renamed Model', description: 'A real description' });
    expect(updated.name).toBe('Renamed Model');
    expect(updated.description).toBe('A real description');
    expect(updated.archived_at).toBeNull();
  });

  it('delete refuses a model that is not archived', async () => {
    const result = await deleteModel(owner.client, modelId);
    expect(result).toEqual({ status: 'not_archived' });
    expect(await getModelById(owner.client, modelId)).not.toBeNull();
  });

  it('delete refuses a non-owner even when archived', async () => {
    await archiveModel(owner.client, modelId);
    await expect(deleteModel(architect.client, modelId)).rejects.toThrow(/only an owner may delete/);
  });

  it('delete cascades through commits/deltas/branches/tags/comments in the right order, real content included', async () => {
    // Seed real content across the FK graph atlas.delete_model has to
    // clear: a manual commit with a create + an update delta (two deltas,
    // one superseding the other via previous_delta_id — the exact
    // self-reference the migration nulls before deleting), a change
    // branch forked from that head, a tag pointing at the same commit, and
    // a comment anchored to the created element.
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    const elementId = randomUUID();
    const createDeltaId = randomUUID();
    const createDelta: Delta = { kind: 'element.create', id: createDeltaId, elementId, elementType: 'system', name: 'Doomed System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 };
    const seedCommitId = randomUUID();
    const seedEnvelope: CommitEnvelope = { id: seedCommitId, branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed', body: null, deltas: [createDelta] };
    const seedResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
    if (!seedResult.ok) throw new Error(`seed commit: ${seedResult.message}`);

    const updateDeltaId = randomUUID();
    const updateDelta: Delta = { kind: 'element.update', id: updateDeltaId, elementId, elementType: 'system', attribute: 'vendor', value: 'Acme', previousDeltaId: createDeltaId, sourceId: source.id, confidence: 1 };
    const updateCommitId = randomUUID();
    const updateEnvelope: CommitEnvelope = { id: updateCommitId, branchId: main.id, parentCommitId: seedCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'update', body: null, deltas: [updateDelta] };
    const updateResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: seedCommitId, envelope: updateEnvelope });
    if (!updateResult.ok) throw new Error(`update commit: ${updateResult.message}`);

    await createTag(owner.client, { id: randomUUID(), orgId, modelId, name: `v-${randomUUID().slice(0, 8)}`, commitId: updateCommitId, createdBy: owner.id });

    const changeBranchId = randomUUID();
    await createChangeBranch(owner.client, { id: changeBranchId, orgId, modelId, name: `doomed-change-${randomUUID().slice(0, 8)}`, createdBy: owner.id, intent: 'propose', mainHeadCommitId: updateCommitId });

    const { error: commentError } = await owner.client.from('comments').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, anchor_type: 'element', anchor_id: elementId, body: 'A comment on the doomed element.', author_id: owner.id });
    if (commentError) throw new Error(`seed comment: ${commentError.message}`);

    // The regression this migration actually fixes (20260927010000): a
    // capture_candidates row whose promoted_commit_id points at a real
    // commit — capture_candidates has no insert RLS policy of its own (only
    // written via the write_capture_draft/apply_capture_decisions RPCs), so
    // seeded via the service-role client, the same way this file already
    // seeds through `service` for cleanup. Reproduces the exact live error:
    // "update or delete on table commits violates foreign key constraint
    // capture_candidates_promoted_commit_id_fkey" when delete_model never
    // cleared capture_jobs/capture_candidates before deleting commits.
    const captureJob = await insertCaptureJob(service, { id: randomUUID(), orgId, modelId, inputKind: 'text', inputName: 'doomed-import.txt', inputRef: `${orgId}/${modelId}/doomed-import.txt`, inputSha256Hex: '00'.repeat(32), documentDate: null, reimportOfJobId: null, createdBy: owner.id });
    const { error: candidateError } = await service.from('capture_candidates').insert({
      id: randomUUID(),
      org_id: orgId,
      job_id: captureJob.id,
      model_id: modelId,
      seq: 1,
      kind: 'element',
      class: 'confirm',
      element_type: 'system',
      draft_subject_id: elementId,
      proposal: { kind: 'element', elementType: 'system', name: 'Doomed System', parent: null, attributes: {} },
      evidence: { sourceRef: null, passage: '', extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [] },
      match: { level: 'exact_id', elementId, score: 1, similar: [], warnings: [] },
      confidence: 1,
      row_key: 'row-1',
      decision: 'accepted',
      promoted_commit_id: updateCommitId,
      promoted_subject_id: elementId,
    });
    if (candidateError) throw new Error(`seed capture_candidates: ${candidateError.message}`);

    // Archive, then delete — the real path a user takes.
    await archiveModel(owner.client, modelId);
    const result = await deleteModel(owner.client, modelId);
    expect(result).toEqual({ status: 'deleted' });
    expect(await getModelById(owner.client, modelId)).toBeNull();

    // Confirm the cascade actually reached every table, not just `models`
    // itself — a broken deletion order would have thrown before getting
    // here, but this also rules out "the RPC returned 'deleted' while
    // silently leaving rows behind".
    const { data: remainingComments } = await service.from('comments').select('id').eq('model_id', modelId);
    expect(remainingComments ?? []).toHaveLength(0);
    const { data: remainingDeltas } = await service.from('deltas').select('id').eq('model_id', modelId);
    expect(remainingDeltas ?? []).toHaveLength(0);
    const { data: remainingBranches } = await service.from('branches').select('id').eq('model_id', modelId);
    expect(remainingBranches ?? []).toHaveLength(0);
    const { data: remainingCaptureJobs } = await service.from('capture_jobs').select('id').eq('model_id', modelId);
    expect(remainingCaptureJobs ?? []).toHaveLength(0);
    const { data: remainingCaptureCandidates } = await service.from('capture_candidates').select('id').eq('model_id', modelId);
    expect(remainingCaptureCandidates ?? []).toHaveLength(0);
  });

  it('delete on an already-deleted (or never-existed) model returns not_found rather than throwing', async () => {
    const result = await deleteModel(owner.client, randomUUID());
    expect(result).toEqual({ status: 'not_found' });
  });
});
