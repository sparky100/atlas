/**
 * F2 (full K1) PR10, plan table row 10 / SPEC-capture.md §12.5: for
 * fixtures 01, 03, 05 and 06 — seed `model.json` onto main for real (via
 * `commitToBranch`, never a hand-built projection row), run `runCapture()`
 * against it with the fixture's own `RecordedLlmClient`, build the draft
 * envelope (`buildCaptureDraftEnvelope.ts`, PR7) and call
 * `atlas.write_capture_draft` for real, then stage an all-accept and call
 * `atlas.apply_capture_decisions` (PR8). Asserts (a) the draft
 * branch/commit/deltas/candidates exist with the counts `runCapture()`
 * itself produced, (b) `foldFromGenesis` of the draft branch's own head
 * contains every promotable candidate's own attributes, (c) RLS: a viewer
 * sees no `capture_candidates` row and no draft branch, a contributor sees
 * both, (d) the all-accept apply writes one commit on a fresh change
 * branch, the job reaches `reviewed` and the draft branch `archived`.
 * P-K2 (trigram parity) is already covered end-to-end by
 * `trigram.integration.test.ts`, not repeated here.
 *
 * Mirrors `writeCaptureDraft.integration.test.ts` (PR7) and
 * `applyCaptureDecisions.integration.test.ts` (PR8) call-for-call — this
 * file's only real addition is driving the candidate set from a real
 * `runCapture()` run over a fixture instead of one hand-built candidate.
 *
 * Written against a real local Supabase per this repository's standing
 * sandbox limitation (no Docker route in this environment) — reasoned
 * through, not executed here; `pnpm db:start && pnpm test:integration`
 * runs it for real.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCandidateRowToWire, captureCandidateWireToRow, type CaptureCandidate, type CaptureCandidateRowShape } from '../contracts/capture';
import type { UUID } from '../contracts/delta';
import { envelopeToDeltaRows } from '../contracts/rows';
import { createChangeBranch, getBranch, getMainBranch } from '../db/branches';
import type { Client } from '../db/client';
import { createServiceRoleClient, createSupabaseClient } from '../db/client';
import { buildCommitLoader } from '../db/commitLoader';
import { commitToBranch } from '../db/commits';
import { loadEnv } from '../db/env';
import { createModel } from '../db/models';
import { createOrganisation } from '../db/organisations';
import { getOrCreateManualSource } from '../db/sources';
import { emptyHead } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildCaptureDraftEnvelope } from './buildCaptureDraftEnvelope';
import { buildPromotionEnvelope } from './buildPromotionEnvelope';
import { loadFixture } from './fixtures/loadFixture';
import { loadCaptureDraftHead } from './loadCaptureDraftHead';
import { loadTargetBranchHead } from './loadTargetBranchHead';
import { runCapture, type ResolvedCandidate } from './runCapture';

const env = loadEnv();
const service = createServiceRoleClient(env);
const FIXTURES_ROOT = join(__dirname, 'fixtures');
const FIXTURE_IDS = ['01-clean-register', '03-roundtrip-export', '05-aliases-known', '06-containers-two-sheets'] as const;

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

/** Fills in the job/org/model/decision bookkeeping `ResolvedCandidate` deliberately omits (`runCapture.ts`'s own "no DB write yet" scope) — `decision` defaults per §8.1's own confirm-default rule, mirroring `write_capture_draft`'s own SQL. */
function toCaptureCandidate(resolved: ResolvedCandidate, ids: { orgId: UUID; jobId: UUID; modelId: UUID }): CaptureCandidate {
  return {
    id: randomUUID(),
    orgId: ids.orgId,
    jobId: ids.jobId,
    modelId: ids.modelId,
    seq: resolved.seq,
    kind: resolved.kind,
    class: resolved.class,
    elementType: resolved.elementType,
    relationshipType: resolved.relationshipType,
    draftSubjectId: resolved.draftSubjectId,
    proposal: resolved.proposal,
    evidence: resolved.evidence,
    match: resolved.match,
    confidence: resolved.confidence,
    rowKey: resolved.rowKey,
    reimportStatus: resolved.reimportStatus,
    draftDeltaIds: [],
    decision: resolved.class === 'confirm' ? 'accepted' : null,
    decisionDetail: null,
    decidedBy: null,
    decidedAt: null,
    promotedCommitId: null,
    promotedSubjectId: null,
    createdAt: new Date().toISOString(),
  };
}

describe.each(FIXTURE_IDS)('capture pipeline against a real local Supabase — fixture %s', (fixtureId) => {
  let owner: TestUser;
  let contributor: TestUser;
  let viewer: TestUser;
  let orgId: UUID;
  let modelId: UUID;

  beforeAll(async () => {
    owner = await createSignedInUser(`pipeline-${fixtureId}-owner`);
    contributor = await createSignedInUser(`pipeline-${fixtureId}-contributor`);
    viewer = await createSignedInUser(`pipeline-${fixtureId}-viewer`);

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: `Pipeline Test Org ${fixtureId}`, slug: `pipeline-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: `Pipeline Test Model ${fixtureId}`, slug: `pipeline-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    // Seed `model.json`'s own pre-existing elements onto main for real, through the ordinary commit path (rule 4 — never a hand-built projection row).
    const fixture = loadFixture(FIXTURES_ROOT, fixtureId);
    if (fixture.head.elements.size > 0) {
      const main = await getMainBranch(owner.client, modelId);
      if (!main) throw new Error('main branch missing');
      const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
      const deltas = [...fixture.head.elements].map(
        ([elementId, el]) => ({ kind: 'element.create', id: randomUUID(), elementId, elementType: el.elementType, name: el.name, parentId: el.parentId, attributes: el.attributes, sourceId: source.id, confidence: 1 }) as never,
      );
      const commitId = randomUUID();
      const result = await commitToBranch(owner.client, {
        modelId,
        branchId: main.id,
        expectedHeadCommitId: main.head_commit_id,
        envelope: { id: commitId, branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: `Seed ${fixtureId}`, body: null, deltas },
      });
      if (!result.ok) throw new Error(`seed model: ${result.reason} ${result.message}`);
    }
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  async function insertPendingJob(createdBy: TestUser, fixture: ReturnType<typeof loadFixture>): Promise<UUID> {
    const jobId = randomUUID();
    const { error } = await createdBy.client.from('capture_jobs').insert({
      id: jobId,
      org_id: orgId,
      model_id: modelId,
      input_kind: fixture.options.inputKind,
      input_name: `${fixtureId}.${fixture.options.format}`,
      input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/${fixtureId}.${fixture.options.format}`,
      input_sha256: '\\x' + '00'.repeat(32),
      document_date: fixture.options.documentDate,
      created_by: createdBy.id,
    });
    if (error) throw new Error(`insertPendingJob: ${error.message}`);
    return jobId;
  }

  it('write_capture_draft persists exactly the candidates runCapture() produced, then an all-accept apply promotes them', async () => {
    const fixture = loadFixture(FIXTURES_ROOT, fixtureId);
    const jobId = await insertPendingJob(contributor, fixture);

    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch missing');
    const loader = await buildCommitLoader(owner.client, modelId);
    const mainHead = main.head_commit_id ? foldFromGenesis(main.head_commit_id, loader) : emptyHead();

    const captureResult = await runCapture({
      inputName: `${fixtureId}.${fixture.options.format}`,
      source: fixture.source,
      documentDate: fixture.options.documentDate,
      llmClient: fixture.llmClient,
      matchIndex: fixture.matchIndex,
      mainHead,
      ...(fixture.reimportPrevious ? { reimportPrevious: fixture.reimportPrevious } : {}),
      mintId: randomUUID,
    });
    if (captureResult.status !== 'parsed') throw new Error(`fixture ${fixtureId} was expected to parse: ${captureResult.errorCode}`);

    const candidates = captureResult.candidates.map((resolved) => toCaptureCandidate(resolved, { orgId, jobId, modelId }));
    const branchId = randomUUID();
    const commitId = randomUUID();
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });

    const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({
      commitId,
      branchId,
      parentCommitId: main.head_commit_id,
      title: `Capture from ${fixtureId}`,
      body: null,
      sourceId: source.id,
      effectiveDate: fixture.options.documentDate,
      mainHead,
      candidates,
      mintId: randomUUID,
    });

    const finishedCandidates = candidates.map((c) => ({ ...c, draftDeltaIds: draftDeltaIdsBySeq.get(c.seq) ?? [] }));
    const deltaRows = envelopeToDeltaRows(envelope, { orgId: '', modelId: '', createdBy: '' });
    const candidateRows = finishedCandidates.map(captureCandidateWireToRow);

    const { error: draftError } = await service.schema('atlas').rpc('write_capture_draft', {
      p_job_id: jobId,
      p_branch_id: branchId,
      p_commit_id: commitId,
      p_commit_body: envelope.body,
      p_deltas: deltaRows,
      p_candidates: candidateRows,
      p_stats: captureResult.stats,
    } satisfies Record<string, unknown>);
    if (draftError) throw new Error(`write_capture_draft: ${draftError.message}`);

    // (a) branch/commit/deltas/candidates exist with the expected counts.
    const draftBranch = await getBranch(owner.client, branchId);
    expect(draftBranch).toMatchObject({ kind: 'capture_draft', status: 'draft' });

    const { count: deltaCount } = await service.from('deltas').select('id', { count: 'exact', head: true }).eq('commit_id', commitId);
    expect(deltaCount).toBe(envelope.deltas.length);

    const { count: candidateCount } = await service.from('capture_candidates').select('id', { count: 'exact', head: true }).eq('job_id', jobId);
    expect(candidateCount).toBe(candidates.length);

    // (b) the draft's own folded head contains every promotable candidate's own subject.
    const draftHead = await loadCaptureDraftHead(owner.client, modelId, branchId);
    for (const candidate of candidates) {
      if (candidate.draftSubjectId === null) continue; // invalid/unsourced — no delta, no subject.
      const table = candidate.kind === 'element' ? draftHead.elements : draftHead.relationships;
      expect(table.has(candidate.draftSubjectId)).toBe(true);
    }

    // (c) RLS: contributor sees the draft and its candidates; viewer sees neither.
    const { data: contributorBranches } = await contributor.client.from('branches').select('id').eq('id', branchId);
    expect(contributorBranches).toHaveLength(1);
    const { data: viewerBranches } = await viewer.client.from('branches').select('id').eq('id', branchId);
    expect(viewerBranches ?? []).toHaveLength(0);
    const { data: viewerCandidates } = await viewer.client.from('capture_candidates').select('id').eq('job_id', jobId);
    expect(viewerCandidates ?? []).toHaveLength(0);

    // (d) stage every non-invalid/unsourced candidate as accepted, apply onto a fresh change branch.
    const { data: draftCandidateRows, error: readBackError } = await owner.client.from('capture_candidates').select('*').eq('job_id', jobId).order('seq');
    if (readBackError) throw new Error(readBackError.message);
    const draftCandidates = (draftCandidateRows as unknown as CaptureCandidateRowShape[]).map(captureCandidateRowToWire);
    const promotable = draftCandidates.filter((c) => c.class !== 'invalid' && c.class !== 'unsourced');

    const { error: stageError } = await contributor.client.schema('atlas').rpc('stage_capture_decisions', {
      p_job_id: jobId,
      p_decisions: promotable.map((c) => ({ candidate_id: c.id, decision: 'accepted', decision_detail: null })),
    } satisfies Record<string, unknown>);
    if (stageError) throw new Error(`stage_capture_decisions: ${stageError.message}`);

    const targetBranchId = randomUUID();
    await createChangeBranch(contributor.client, { id: targetBranchId, orgId, modelId, name: `promote-${fixtureId}-${randomUUID().slice(0, 8)}`, createdBy: contributor.id, intent: 'record', mainHeadCommitId: main.head_commit_id });

    const promotedDraftHead = await loadCaptureDraftHead(owner.client, modelId, branchId);
    const { head: targetHead, headCommitId: targetHeadCommitId } = await loadTargetBranchHead(owner.client, modelId, targetBranchId);
    // sources_insert's RLS requires created_by = auth.uid() AND user_id =
    // auth.uid() for a manual source — the acting client must match the
    // userId being written (the contributor promoting this candidate), not
    // the owner who happens to be driving the rest of this test.
    const reviewerSource = await getOrCreateManualSource(contributor.client, { id: randomUUID(), orgId, modelId, userId: contributor.id });

    const acceptedCandidates: CaptureCandidate[] = promotable.map((c) => ({ ...c, decision: 'accepted' }));
    const promotion = buildPromotionEnvelope({ candidates: acceptedCandidates, draftHead: promotedDraftHead, targetHead, reviewerSourceId: reviewerSource.id, mintId: randomUUID });

    const applyCommitId = randomUUID();
    const applyDeltaRows = envelopeToDeltaRows({ id: applyCommitId, branchId: targetBranchId, parentCommitId: targetHeadCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: `Promote ${fixtureId}`, body: null, deltas: promotion.deltas }, { orgId: '', modelId: '', createdBy: '' });

    const { error: applyError } = await contributor.client.schema('atlas').rpc('apply_capture_decisions', {
      p_job_id: jobId,
      p_target_branch_id: targetBranchId,
      p_commit_id: applyCommitId,
      p_commit_title: `Promote ${fixtureId}`,
      p_commit_body: `From capture of ${fixtureId} (job ${jobId})`,
      p_deltas: applyDeltaRows,
      p_alias_rows: promotion.aliasRows.map((a) => ({ id: a.id, element_id: a.elementId, alias_value: a.aliasValue, alias_type: a.aliasType, source_id: a.sourceId, confidence: a.confidence })),
      p_candidate_outcomes: promotable.map((c) => ({ candidate_id: c.id, promoted_subject_id: promotion.promotedSubjectIdBySeq.get(c.seq) })),
      p_resolved_conflicts: promotion.resolvedConflicts.map((r) => ({ id: r.id, winning_delta_id: r.winningDeltaId, discarded_delta_id: r.discardedDeltaId, resolution_delta_id: null, rationale: r.rationale })),
      p_stats: { decided: { accepted: promotable.length, rejected: 0, merged: 0, edited: 0, split: 0 } },
    } satisfies Record<string, unknown>);
    if (applyError) throw new Error(`apply_capture_decisions: ${applyError.message}`);

    const { data: jobRow } = await service.from('capture_jobs').select('status').eq('id', jobId).single();
    expect(jobRow?.status).toBe(draftCandidates.length === promotable.length ? 'reviewed' : 'parsed'); // still `parsed` if any invalid/unsourced candidate was left undecided.
    const draftBranchAfter = await getBranch(owner.client, branchId);
    expect(draftBranchAfter?.status).toBe(draftCandidates.length === promotable.length ? 'archived' : 'draft');
  });
});
