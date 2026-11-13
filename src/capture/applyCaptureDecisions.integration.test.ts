/**
 * F2 (full K1) PR8, SPEC-capture.md §8.2: RT-style round trip for
 * `atlas.stage_capture_decisions`/`atlas.apply_capture_decisions` and
 * P-K6 (all-or-nothing) — real Supabase, real RLS, no shortcuts, same
 * shape as `writeCaptureDraft.integration.test.ts` (PR7).
 *
 * Written against a real local Supabase per this repository's standing
 * sandbox limitation (no Docker route in this environment) — reasoned
 * through, not executed here; `pnpm db:start && pnpm test:integration`
 * runs it for real.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCandidateRowToWire, captureCandidateWireToRow, type CaptureCandidate, type CaptureCandidateRowShape, type CaptureInputKind } from '../contracts/capture';
import { envelopeToDeltaRows } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { createChangeBranch, getBranch, getMainBranch } from '../db/branches';
import type { Client } from '../db/client';
import { getCaptureJob } from '../db/captureJobs';
import { createServiceRoleClient, createSupabaseClient } from '../db/client';
import { buildCommitLoader } from '../db/commitLoader';
import { loadEnv } from '../db/env';
import { createModel } from '../db/models';
import { createOrganisation } from '../db/organisations';
import { getOrCreateManualSource } from '../db/sources';
import { emptyHead } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildCaptureDraftEnvelope } from './buildCaptureDraftEnvelope';
import { buildPromotionEnvelope } from './buildPromotionEnvelope';
import { loadCaptureDraftHead } from './loadCaptureDraftHead';
import { loadTargetBranchHead } from './loadTargetBranchHead';

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

describe('stage_capture_decisions / apply_capture_decisions against a real local Supabase', () => {
  let owner: TestUser;
  let contributor: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('applydecisions-owner');
    contributor = await createSignedInUser('applydecisions-contributor');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Apply Decisions Test Org', slug: `applydecisions-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([{ org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id }]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Apply Decisions Test Model', slug: `applydecisions-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  /** Mirrors `writeCaptureDraft.integration.test.ts`'s own helper: one 'new' system candidate in a single draft — everything below needs is one promotable candidate, not a specific mix of classes. */
  async function writeDraftWithNewCandidate(jobId: UUID): Promise<{ draftBranchId: UUID }> {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const loader = await buildCommitLoader(owner.client, modelId);
    const mainHead = main.head_commit_id ? foldFromGenesis(main.head_commit_id, loader) : emptyHead();
    const manualSource = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    const newCandidate: CaptureCandidate = {
      id: randomUUID(),
      orgId,
      jobId,
      modelId,
      seq: 0,
      kind: 'element',
      class: 'new',
      elementType: 'system',
      relationshipType: null,
      draftSubjectId: randomUUID(),
      proposal: { kind: 'element', elementType: 'system', name: 'CRM', parent: null, attributes: { lifecycleStatus: 'active', isExternal: false, vendor: 'Acme' } },
      evidence: { sourceRef: { kind: 'sheet', sheet: 'Applications', range: 'A2:C2' }, passage: 'CRM | Acme', extractor: 'sheet-mapping', attributeConfidence: { vendor: 0.95 }, warnings: [] },
      match: { level: 'none', score: 0, similar: [], warnings: [] },
      confidence: 0.9,
      rowKey: 'name:system:crm:',
      reimportStatus: null,
      draftDeltaIds: [],
      aliasProposals: [],
      decision: null,
      decisionDetail: null,
      decidedBy: null,
      decidedAt: null,
      promotedCommitId: null,
      promotedSubjectId: null,
      createdAt: new Date().toISOString(),
    };

    const branchId = randomUUID();
    const commitId = randomUUID();
    const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({
      commitId,
      branchId,
      parentCommitId: main.head_commit_id,
      title: 'Capture from Applications.xlsx',
      body: null,
      sourceId: manualSource.id,
      effectiveDate: '2026-02-01',
      mainHead,
      candidates: [newCandidate],
      // write_capture_draft casts each delta's id straight to uuid — this
      // used to mint a debug-friendly "delta-N-<uuid>" string instead of a
      // plain uuid, which the RPC rejected outright. Match production
      // wiring (supabase/functions/capture-run/index.ts's own mintId).
      mintId: () => randomUUID(),
    });

    const finishedCandidate: CaptureCandidate = { ...newCandidate, draftDeltaIds: draftDeltaIdsBySeq.get(0) ?? [] };
    const deltaRows = envelopeToDeltaRows(envelope, { orgId: '', modelId: '', createdBy: '' });
    const candidateRows = [captureCandidateWireToRow(finishedCandidate)];

     
    const { error } = await service.schema('atlas').rpc('write_capture_draft', {
      p_job_id: jobId,
      p_branch_id: branchId,
      p_commit_id: commitId,
      p_commit_body: '1 new candidate.',
      p_deltas: deltaRows,
      p_candidates: candidateRows,
      p_stats: { candidates: 1, byClass: { new: 1 } },
    } satisfies Record<string, unknown>);
    if (error) throw new Error(`write_capture_draft: ${error.message}`);

    return { draftBranchId: branchId };
  }

  async function insertPendingJob(createdBy: TestUser, inputKind: CaptureInputKind = 'spreadsheet'): Promise<UUID> {
    const jobId = randomUUID();
    const { error } = await createdBy.client.from('capture_jobs').insert({
      id: jobId,
      org_id: orgId,
      model_id: modelId,
      input_kind: inputKind,
      input_name: 'Applications.xlsx',
      input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/Applications.xlsx`,
      input_sha256: '\\x' + '00'.repeat(32),
      document_date: '2026-02-01',
      created_by: createdBy.id,
    });
    if (error) throw new Error(`insertPendingJob: ${error.message}`);
    return jobId;
  }

  it.each(['spreadsheet', 'change_brief'] as const)('RT: %s review and promotion read back consistently', async (inputKind) => {
    const jobId = await insertPendingJob(contributor, inputKind);
    expect((await getCaptureJob(contributor.client, jobId))?.inputKind).toBe(inputKind);
    const { draftBranchId } = await writeDraftWithNewCandidate(jobId);

    const { data: draftCandidateRows, error: draftCandidateError } = await owner.client.from('capture_candidates').select('*').eq('job_id', jobId).order('seq');
    if (draftCandidateError) throw new Error(draftCandidateError.message);
    const candidates = (draftCandidateRows as unknown as CaptureCandidateRowShape[]).map(captureCandidateRowToWire);

     
    const { error: stageError } = await contributor.client.schema('atlas').rpc('stage_capture_decisions', {
      p_job_id: jobId,
      p_decisions: [{ candidate_id: candidates[0]?.id, decision: 'accepted', decision_detail: null }],
    } satisfies Record<string, unknown>);
    if (stageError) throw new Error(`stage_capture_decisions: ${stageError.message}`);

    const targetBranchId = randomUUID();
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    await createChangeBranch(contributor.client, { id: targetBranchId, orgId, modelId, name: `promote-into-${randomUUID().slice(0, 8)}`, createdBy: contributor.id, intent: 'record', mainHeadCommitId: main.head_commit_id });

    const draftHead = await loadCaptureDraftHead(owner.client, modelId, draftBranchId);
    const { head: targetHead, headCommitId: targetHeadCommitId } = await loadTargetBranchHead(owner.client, modelId, targetBranchId);
    // sources_insert's RLS requires created_by = auth.uid() AND user_id =
    // auth.uid() for a manual source — the acting client must match the
    // userId being written (same fix as pipeline.integration.test.ts's own
    // equivalent call).
    const reviewerSource = await getOrCreateManualSource(contributor.client, { id: randomUUID(), orgId, modelId, userId: contributor.id });

    // apply_capture_decisions also casts each delta's id straight to uuid —
    // same D1 fix as buildCaptureDraftEnvelope's own mintId above.
    const mintId = () => randomUUID();
    const { deltas, promotedSubjectIdBySeq, aliasRows, resolvedConflicts } = buildPromotionEnvelope({
      candidates: [{ ...candidates[0], decision: 'accepted' } as CaptureCandidate],
      draftHead,
      targetHead,
      reviewerSourceId: reviewerSource.id,
      mintId,
    });

    const commitId = randomUUID();
    const deltaRows = envelopeToDeltaRows({ id: commitId, branchId: targetBranchId, parentCommitId: targetHeadCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'x', body: null, deltas }, { orgId: '', modelId: '', createdBy: '' });

     
    const args = {
      p_job_id: jobId,
      p_target_branch_id: targetBranchId,
      p_commit_id: commitId,
      p_commit_title: 'Add system CRM',
      p_commit_body: `From capture of Applications.xlsx (job ${jobId})`,
      p_deltas: deltaRows,
      p_alias_rows: aliasRows.map((a) => ({ id: a.id, element_id: a.elementId, alias_value: a.aliasValue, alias_type: a.aliasType, source_id: a.sourceId, confidence: a.confidence })),
      p_candidate_outcomes: [{ candidate_id: candidates[0]?.id, promoted_subject_id: promotedSubjectIdBySeq.get(0) }],
      p_resolved_conflicts: resolvedConflicts.map((r) => ({ id: r.id, winning_delta_id: r.winningDeltaId, discarded_delta_id: r.discardedDeltaId, resolution_delta_id: null, rationale: r.rationale })),
      p_stats: { decided: { accepted: 1, rejected: 0, merged: 0, edited: 0, split: 0 } },
    } satisfies Record<string, unknown>;
    if (inputKind === 'change_brief') {
      const rejected = await contributor.client.schema('atlas').rpc('apply_capture_decisions', args);
      expect(rejected.error?.message).toContain('AI draft edits must be applied to a draft Propose change.');
      expect((await getBranch(contributor.client, targetBranchId))?.head_commit_id).toBe(targetHeadCommitId);
      expect((await getCaptureJob(contributor.client, jobId))?.status).toBe('parsed');
      const changeIntent = await contributor.client.from('branches').update({ intent: 'propose' }).eq('id', targetBranchId);
      expect(changeIntent.error).toBeNull();
    }
    const { data, error: applyError } = await contributor.client.schema('atlas').rpc('apply_capture_decisions', args);
    if (applyError) throw new Error(`apply_capture_decisions: ${applyError.message}`);
    expect((data as { id: UUID }).id).toBe(commitId);

    const promotedId = promotedSubjectIdBySeq.get(0);
    const { data: elementsHeadRow, error: elementsHeadError } = await owner.client.from('elements_head').select('*').eq('element_id', promotedId).maybeSingle();
    if (elementsHeadError) throw new Error(elementsHeadError.message);
    expect(elementsHeadRow).toBeNull(); // a `change` branch is never materialised (§3.5) — this asserts the *absence*, matching P-6.

    const { data: candidateAfter, error: candidateAfterError } = await owner.client.from('capture_candidates').select('*').eq('id', candidates[0]?.id).single();
    if (candidateAfterError) throw new Error(candidateAfterError.message);
    expect(candidateAfter).toMatchObject({ promoted_commit_id: commitId, promoted_subject_id: promotedId });

    const { data: job, error: jobError } = await owner.client.from('capture_jobs').select('*').eq('id', jobId).single();
    if (jobError) throw new Error(jobError.message);
    expect(job).toMatchObject({ target_branch_id: targetBranchId, status: 'reviewed' }); // the one candidate was the only one, now decided.
    if (inputKind === 'change_brief') {
      const changed = await contributor.client.from('branches').update({ intent: 'record' }).eq('id', targetBranchId);
      expect(changed.error?.message).toContain('must keep its Propose intent');
    }


    const draftBranchAfter = await getBranch(owner.client, draftBranchId);
    expect(draftBranchAfter?.status).toBe('archived');
  });

  it('apply_capture_decisions refuses a target branch that is not draft', async () => {
    const jobId = await insertPendingJob(contributor);
    await writeDraftWithNewCandidate(jobId);
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');

     
    const { error } = await contributor.client.schema('atlas').rpc('apply_capture_decisions', {
      p_job_id: jobId,
      p_target_branch_id: main.id, // main is never a valid target (kind <> 'change').
      p_commit_id: randomUUID(),
      p_commit_title: 'x',
      p_commit_body: null,
      p_deltas: [],
      p_alias_rows: [],
      p_candidate_outcomes: [],
      p_resolved_conflicts: [],
      p_stats: {},
    } satisfies Record<string, unknown>);
    expect(error?.message).toMatch(/not a change branch/);
  });

  it('P-K6: an invalid delta rolls back the whole apply — no partial candidate/job/alias state', async () => {
    const jobId = await insertPendingJob(contributor);
    const { draftBranchId } = await writeDraftWithNewCandidate(jobId);
    const targetBranchId = randomUUID();
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    await createChangeBranch(contributor.client, { id: targetBranchId, orgId, modelId, name: `promote-into-${randomUUID().slice(0, 8)}`, createdBy: contributor.id, intent: 'record', mainHeadCommitId: main.head_commit_id });

    const { data: draftCandidateRows } = await owner.client.from('capture_candidates').select('*').eq('job_id', jobId).order('seq');
    const candidateId = (draftCandidateRows as { id: UUID }[] | null)?.[0]?.id;

    // A delta with a nonexistent previous_delta_id fails the deltas FK inside atlas.commit_deltas — the whole transaction, including the candidate_outcomes/alias/job-status steps below it, must roll back with it.
    const badDeltaRow = { id: randomUUID(), kind: 'element_update', subject_id: randomUUID(), attribute: 'vendor', element_type: 'system', value: 'Acme', previous_delta_id: randomUUID(), source_id: (await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: contributor.id })).id, source_ref: null, effective_date: null, confidence: 1 };

     
    const { error } = await contributor.client.schema('atlas').rpc('apply_capture_decisions', {
      p_job_id: jobId,
      p_target_branch_id: targetBranchId,
      p_commit_id: randomUUID(),
      p_commit_title: 'Should not land',
      p_commit_body: null,
      p_deltas: [badDeltaRow],
      p_alias_rows: [],
      p_candidate_outcomes: [{ candidate_id: candidateId, promoted_subject_id: randomUUID() }],
      p_resolved_conflicts: [],
      p_stats: { decided: { accepted: 1, rejected: 0, merged: 0, edited: 0, split: 0 } },
    } satisfies Record<string, unknown>);
    expect(error).not.toBeNull();

    const { data: candidateAfter } = await owner.client.from('capture_candidates').select('promoted_commit_id, promoted_subject_id').eq('id', candidateId).single();
    expect(candidateAfter).toMatchObject({ promoted_commit_id: null, promoted_subject_id: null });

    const { data: job } = await owner.client.from('capture_jobs').select('status, target_branch_id').eq('id', jobId).single();
    expect(job).toMatchObject({ status: 'parsed', target_branch_id: null });

    const draftBranchAfter = await getBranch(owner.client, draftBranchId);
    expect(draftBranchAfter?.status).toBe('draft'); // never archived by the failed attempt.
  });

  async function stageDecision(user: TestUser, jobId: UUID, decision: 'accepted' | 'rejected' | null): Promise<void> {
    const { data: rows } = await owner.client.from('capture_candidates').select('id').eq('job_id', jobId).order('seq');
    const candidateId: UUID | undefined = rows?.[0]?.id;
    const { error } = await user.client.schema('atlas').rpc('stage_capture_decisions', {
      p_job_id: jobId,
      p_decisions: [{ candidate_id: candidateId, decision, decision_detail: null }],
    } satisfies Record<string, unknown>);
    if (error) throw new Error(`stage_capture_decisions: ${error.message}`);
  }

  describe('finish_capture_review (SPEC-capture.md §8.2, amended)', () => {
    it('RT: an all-rejected review closes as reviewed with no target change and no commit, the draft archived and the rejection kept', async () => {
      const jobId = await insertPendingJob(contributor);
      const { draftBranchId } = await writeDraftWithNewCandidate(jobId);
      await stageDecision(contributor, jobId, 'rejected');
      const draftBefore = await getBranch(owner.client, draftBranchId);

      const { data, error } = await contributor.client.schema('atlas').rpc('finish_capture_review', { p_job_id: jobId });
      if (error) throw new Error(`finish_capture_review: ${error.message}`);
      expect(data).toMatchObject({ id: jobId, status: 'reviewed', target_branch_id: null });

      const { data: job } = await owner.client.from('capture_jobs').select('status, target_branch_id').eq('id', jobId).single();
      expect(job).toMatchObject({ status: 'reviewed', target_branch_id: null });

      const draftAfter = await getBranch(owner.client, draftBranchId);
      expect(draftAfter?.status).toBe('archived');
      expect(draftAfter?.head_commit_id).toBe(draftBefore?.head_commit_id); // no commit written anywhere.

      const { data: candidate } = await owner.client.from('capture_candidates').select('decision, promoted_commit_id').eq('job_id', jobId).single();
      expect(candidate).toMatchObject({ decision: 'rejected', promoted_commit_id: null }); // "recorded, not deleted".
    });

    it('refuses while a candidate is undecided', async () => {
      const jobId = await insertPendingJob(contributor);
      await writeDraftWithNewCandidate(jobId);

      const { error } = await contributor.client.schema('atlas').rpc('finish_capture_review', { p_job_id: jobId });
      expect(error?.message).toMatch(/CANDIDATES_UNDECIDED/);
      const { data: job } = await owner.client.from('capture_jobs').select('status').eq('id', jobId).single();
      expect(job).toMatchObject({ status: 'parsed' });
    });

    it('refuses while an accepted candidate has not been applied to a change', async () => {
      const jobId = await insertPendingJob(contributor);
      await writeDraftWithNewCandidate(jobId);
      await stageDecision(contributor, jobId, 'accepted');

      const { error } = await contributor.client.schema('atlas').rpc('finish_capture_review', { p_job_id: jobId });
      expect(error?.message).toMatch(/CANDIDATES_UNAPPLIED/);
      const { data: job } = await owner.client.from('capture_jobs').select('status').eq('id', jobId).single();
      expect(job).toMatchObject({ status: 'parsed' });
    });

    it('refuses a job that is no longer parsed', async () => {
      const jobId = await insertPendingJob(contributor);
      await writeDraftWithNewCandidate(jobId);
      await stageDecision(contributor, jobId, 'rejected');
      const { error: discardError } = await contributor.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
      if (discardError) throw new Error(`discard_capture_job: ${discardError.message}`);

      const { error } = await contributor.client.schema('atlas').rpc('finish_capture_review', { p_job_id: jobId });
      expect(error?.message).toMatch(/must be parsed/);
    });

    it('refuses someone with no role in the organisation', async () => {
      const outsider = await createSignedInUser('applydecisions-outsider');
      const jobId = await insertPendingJob(contributor);
      await writeDraftWithNewCandidate(jobId);
      await stageDecision(contributor, jobId, 'rejected');

      const { error } = await outsider.client.schema('atlas').rpc('finish_capture_review', { p_job_id: jobId });
      expect(error).not.toBeNull();
      const { data: job } = await owner.client.from('capture_jobs').select('status').eq('id', jobId).single();
      expect(job).toMatchObject({ status: 'parsed' });
    });
  });

  it('discard_capture_job discards a parsed job that already carries review decisions, keeping the decisions', async () => {
    const jobId = await insertPendingJob(contributor);
    const { draftBranchId } = await writeDraftWithNewCandidate(jobId);
    await stageDecision(contributor, jobId, 'rejected');

    const { error } = await contributor.client.schema('atlas').rpc('discard_capture_job', { p_job_id: jobId });
    if (error) throw new Error(`discard_capture_job: ${error.message}`);

    const { data: job } = await owner.client.from('capture_jobs').select('status').eq('id', jobId).single();
    expect(job).toMatchObject({ status: 'discarded' });
    expect((await getBranch(owner.client, draftBranchId))?.status).toBe('archived');
    const { data: candidate } = await owner.client.from('capture_candidates').select('decision').eq('job_id', jobId).single();
    expect(candidate).toMatchObject({ decision: 'rejected' });
  });
});
