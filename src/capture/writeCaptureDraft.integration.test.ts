/**
 * F2 (full K1) PR7, SPEC-capture.md §8.1/§3.2: RT-K2 (`atlas.write_capture_draft`
 * round trip), P-K7's first half (RLS: a viewer sees none of this; a
 * contributor sees it all), and `atlas.discard_capture_job`'s own
 * status/role transitions — real Supabase, real RLS, no shortcuts, same
 * shape as `cancelChange.integration.test.ts`.
 *
 * `write_capture_draft` itself is service-role only (no grant to
 * `authenticated` at all — see the migration's own header comment), so
 * every call here goes through the service-role client, exactly as
 * `capture-run` (PR12) will once it exists. `discard_capture_job` is the
 * one ordinary authenticated RPC in this file.
 *
 * Written against a real local Supabase per this repository's standing
 * sandbox limitation (no Docker route in this environment) — reasoned
 * through, not executed here; `pnpm db:start && pnpm test:integration`
 * runs it for real.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCandidateWireToRow, type CaptureCandidate } from '../contracts/capture';
import { envelopeToDeltaRows } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { getMainBranch } from '../db/branches';
import type { Client } from '../db/client';
import { createServiceRoleClient, createSupabaseClient } from '../db/client';
import { buildCommitLoader } from '../db/commitLoader';
import { loadEnv } from '../db/env';
import { createModel } from '../db/models';
import { createOrganisation } from '../db/organisations';
import { getOrCreateManualSource } from '../db/sources';
import { emptyHead } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildCaptureDraftEnvelope } from './buildCaptureDraftEnvelope';

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

describe('write_capture_draft / discard_capture_job against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let bystander: TestUser;
  let viewer: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('capturedraft-owner');
    contributor = await createSignedInUser('capturedraft-contributor');
    bystander = await createSignedInUser('capturedraft-bystander');
    viewer = await createSignedInUser('capturedraft-viewer');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Capture Draft Test Org', slug: `capturedraft-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: bystander.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Capture Draft Test Model', slug: `capturedraft-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  /** Inserts a `pending` job (client insert, RLS: contributor+, created_by = auth.uid()) and returns its id. */
  async function insertPendingJob(createdBy: TestUser, inputName = 'Applications.xlsx'): Promise<UUID> {
    const jobId = randomUUID();
    const { error } = await createdBy.client.from('capture_jobs').insert({
      id: jobId,
      org_id: orgId,
      model_id: modelId,
      input_kind: 'spreadsheet',
      input_name: inputName,
      input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/${inputName}`,
      input_sha256: '\\x' + '00'.repeat(32),
      document_date: '2026-02-01',
      created_by: createdBy.id,
    });
    if (error) throw new Error(`insertPendingJob: ${error.message}`);
    return jobId;
  }

  /** Builds a one-candidate ('new' system) envelope and calls the real RPC as service role — the shape `capture-run` (PR12) will produce for real. */
  async function writeDraftFor(jobId: UUID): Promise<{ branchId: UUID; commitId: UUID; elementId: UUID; deltaId: UUID; candidateId: UUID }> {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const loader = await buildCommitLoader(owner.client, modelId);
    const mainHead = main.head_commit_id ? foldFromGenesis(main.head_commit_id, loader) : emptyHead();

    const branchId = randomUUID();
    const commitId = randomUUID();
    const elementId = randomUUID();

    // This test has no real capture `sources` row (that's `capture-run`'s
    // own parse stage, PR12, per SPEC §3.1) — a `manual` source stands in
    // so the deltas' own `source_id` FK is satisfiable; the RPC itself
    // never creates or reads `sources` rows at all (see the migration's
    // own header comment: it persists an already-built envelope, nothing
    // more).
    const manualSource = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    const candidateBase: CaptureCandidate = {
      id: randomUUID(),
      orgId,
      jobId,
      modelId,
      seq: 0,
      kind: 'element',
      class: 'new',
      elementType: 'system',
      relationshipType: null,
      draftSubjectId: elementId,
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' } },
      evidence: { sourceRef: { kind: 'sheet', sheet: 'Applications', range: 'A2:C2' }, passage: 'CRM | Acme', extractor: 'sheet-mapping', attributeConfidence: { vendor: 0.95 }, warnings: [] },
      match: { level: 'none', score: 0, similar: [], warnings: [] },
      confidence: 0.9,
      rowKey: 'name:system:crm:',
      reimportStatus: null,
      draftDeltaIds: [],
      // issue #284: proves alias_proposals round-trips through the real RPC, not just the pure row<->wire mapping RT-K1 already covers.
      aliasProposals: [{ type: 'source_system_key', value: 'APP-101' }],
      decision: null,
      decisionDetail: null,
      decidedBy: null,
      decidedAt: null,
      promotedCommitId: null,
      promotedSubjectId: null,
      createdAt: new Date().toISOString(),
    };

    const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({
      commitId,
      branchId,
      parentCommitId: main.head_commit_id,
      title: `Capture from ${candidateBase.evidence.passage}`,
      body: null,
      sourceId: manualSource.id,
      effectiveDate: '2026-02-01',
      mainHead,
      candidates: [candidateBase],
      // write_capture_draft casts each delta's id straight to uuid — this
      // used to mint a debug-friendly "delta-N-<uuid>" string instead of a
      // plain uuid, which the RPC rejected outright. Match production
      // wiring (supabase/functions/capture-run/index.ts's own mintId).
      mintId: () => randomUUID(),
    });

    const finishedCandidate: CaptureCandidate = { ...candidateBase, draftDeltaIds: draftDeltaIdsBySeq.get(0) ?? [] };
    const deltaRows = envelopeToDeltaRows(envelope, { orgId: '', modelId: '', createdBy: '' });
    const candidateRows = [captureCandidateWireToRow(finishedCandidate)];

     
    const { data, error } = await service.schema('atlas').rpc('write_capture_draft', {
      p_job_id: jobId,
      p_branch_id: branchId,
      p_commit_id: commitId,
      p_commit_body: '1 new candidate.',
      p_deltas: deltaRows,
      p_candidates: candidateRows,
      p_stats: { candidates: 1, byClass: { new: 1 } },
    } satisfies Record<string, unknown>);
    if (error) throw new Error(`write_capture_draft: ${error.message}`);
    expect((data as { id: UUID }).id).toBe(branchId);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { branchId, commitId, elementId, deltaId: envelope.deltas[0]!.id, candidateId: finishedCandidate.id };
  }

  it('RT-K2: writes branch, commit, deltas (by seq) and candidates (by seq) that read back exactly as built', async () => {
    const jobId = await insertPendingJob(contributor);
    const { branchId, commitId, elementId, deltaId, candidateId } = await writeDraftFor(jobId);

    const { data: branch, error: branchError } = await owner.client.from('branches').select('*').eq('id', branchId).single();
    if (branchError) throw new Error(branchError.message);
    expect(branch).toMatchObject({ kind: 'capture_draft', status: 'draft', name: `capture/${jobId}`, head_commit_id: commitId });

    const { data: commit, error: commitError } = await owner.client.from('commits').select('*').eq('id', commitId).single();
    if (commitError) throw new Error(commitError.message);
    expect(commit).toMatchObject({ kind: 'capture', branch_id: branchId, title: expect.stringContaining('Capture from') });

    const { data: deltaRows, error: deltaError } = await owner.client.from('deltas').select('*').eq('commit_id', commitId).order('seq');
    if (deltaError) throw new Error(deltaError.message);
    expect(deltaRows).toEqual([expect.objectContaining({ id: deltaId, seq: 0, kind: 'element_create', subject_id: elementId })]);

    const { data: candidateRows, error: candidateError } = await owner.client.from('capture_candidates').select('*').eq('job_id', jobId).order('seq');
    if (candidateError) throw new Error(candidateError.message);
    expect(candidateRows).toEqual([expect.objectContaining({ id: candidateId, seq: 0, class: 'new', draft_subject_id: elementId, draft_delta_ids: [deltaId], alias_proposals: [{ type: 'source_system_key', value: 'APP-101' }] })]);

    const { data: job, error: jobError } = await owner.client.from('capture_jobs').select('*').eq('id', jobId).single();
    if (jobError) throw new Error(jobError.message);
    expect(job).toMatchObject({ status: 'parsed', resulting_branch_id: branchId, progress: null });
  });

  it('write_capture_draft refuses a caller that is not the service role', async () => {
    const jobId = await insertPendingJob(contributor);
     
    const { error } = await contributor.client.schema('atlas').rpc('write_capture_draft', {
      p_job_id: jobId,
      p_branch_id: randomUUID(),
      p_commit_id: randomUUID(),
      p_commit_body: null,
      p_deltas: [],
      p_candidates: [],
      p_stats: {},
    } satisfies Record<string, unknown>);
    expect(error).not.toBeNull();
  });

  it('write_capture_draft refuses a job that is not pending', async () => {
    const jobId = await insertPendingJob(contributor);
    await writeDraftFor(jobId);
     
    const { error } = await service.schema('atlas').rpc('write_capture_draft', {
      p_job_id: jobId,
      p_branch_id: randomUUID(),
      p_commit_id: randomUUID(),
      p_commit_body: null,
      p_deltas: [],
      p_candidates: [],
      p_stats: {},
    } satisfies Record<string, unknown>);
    expect(error?.message).toMatch(/must be pending/);
  });

  it("P-K7 (first half): a viewer sees zero rows of a draft job/candidates/branch; a contributor sees them all", async () => {
    const jobId = await insertPendingJob(contributor);
    const { branchId } = await writeDraftFor(jobId);

    const { data: viewerJobs } = await viewer.client.from('capture_jobs').select('id').eq('id', jobId);
    expect(viewerJobs).toEqual([]);
    const { data: viewerCandidates } = await viewer.client.from('capture_candidates').select('id').eq('job_id', jobId);
    expect(viewerCandidates).toEqual([]);
    const { data: viewerBranch } = await viewer.client.from('branches').select('id').eq('id', branchId);
    expect(viewerBranch).toEqual([]);

    const { data: contributorJobs } = await contributor.client.from('capture_jobs').select('id').eq('id', jobId);
    expect(contributorJobs).toEqual([{ id: jobId }]);
    const { data: contributorCandidates } = await contributor.client.from('capture_candidates').select('id').eq('job_id', jobId);
    expect(contributorCandidates).toHaveLength(1);
  });

  it('nobody with an application role can insert/update capture_candidates directly (P-K7)', async () => {
    const jobId = await insertPendingJob(contributor);
    const { error } = await owner.client.from('capture_candidates').insert({ id: randomUUID(), org_id: orgId, job_id: jobId, model_id: modelId, seq: 0, kind: 'element', class: 'new', element_type: 'system', draft_subject_id: randomUUID(), proposal: {}, evidence: {}, match: {}, confidence: 1, row_key: 'x' });
    expect(error).not.toBeNull();
  });
});

describe('discard_capture_job against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let bystander: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('discardjob-owner');
    contributor = await createSignedInUser('discardjob-contributor');
    bystander = await createSignedInUser('discardjob-bystander');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Discard Job Test Org', slug: `discardjob-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: bystander.id, role: 'contributor', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Discard Job Test Model', slug: `discardjob-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  async function insertPendingJob(createdBy: TestUser): Promise<UUID> {
    const jobId = randomUUID();
    const { error } = await createdBy.client.from('capture_jobs').insert({
      id: jobId,
      org_id: orgId,
      model_id: modelId,
      input_kind: 'spreadsheet',
      input_name: 'Applications.xlsx',
      input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/Applications.xlsx`,
      input_sha256: '\\x' + '00'.repeat(32),
      created_by: createdBy.id,
    });
    if (error) throw new Error(`insertPendingJob: ${error.message}`);
    return jobId;
  }

  it('the creator can discard their own pending job', async () => {
    const jobId = await insertPendingJob(contributor);
     
    const { data, error } = await contributor.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
    if (error) throw new Error(error.message);
    expect((data as { status: string }).status).toBe('discarded');
  });

  it('a bystander contributor (not the creator, not owner/architect) is refused', async () => {
    const jobId = await insertPendingJob(contributor);
     
    const { error } = await bystander.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
    expect(error?.message).toMatch(/only the contributor\+ who created this job/);
  });

  it('an owner can discard a job that is not theirs', async () => {
    const jobId = await insertPendingJob(contributor);
     
    const { data, error } = await owner.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
    if (error) throw new Error(error.message);
    expect((data as { status: string }).status).toBe('discarded');
  });

  it('discarding an already-discarded job is refused', async () => {
    const jobId = await insertPendingJob(contributor);
     
    await contributor.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
     
    const { error } = await contributor.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
    expect(error?.message).toMatch(/must be pending or parsed/);
  });
});
