/**
 * The capture review's way out (SPEC-capture.md §3.2/§8.2/§10, amended):
 * an all-rejected review finishes with no target change, and a duplicate
 * draft is discarded from the review queue — both by tap, at 390px, the
 * width the bug was found at.
 *
 * Engine spec, not a golden path: it seeds two parsed drafts of the same
 * file through the real `write_capture_draft` RPC (service role, exactly
 * as `capture-run` itself calls it) instead of uploading a file, so it
 * runs without a working `capture-run` deployment.
 * `e2e/golden-path-capture-review.spec.ts`'s last test is the click-only
 * version of the same flow from upload onward.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { buildCaptureDraftEnvelope } from '../src/capture/buildCaptureDraftEnvelope';
import { captureCandidateWireToRow, type CaptureCandidate } from '../src/contracts/capture';
import { envelopeToDeltaRows } from '../src/contracts/rows';
import { getMainBranch } from '../src/db/branches';
import { buildCommitLoader } from '../src/db/commitLoader';
import { createServiceRoleClient, createSupabaseClient, type Client } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { getOrCreateManualSource } from '../src/db/sources';
import { foldFromGenesis } from '../src/engine/head';

const INPUT_NAME = 'ActionPlan.pdf';

async function seedParsedDraft(client: Client, service: Client, ids: { orgId: string; modelId: string; userId: string }, createdAt: string): Promise<string> {
  const { orgId, modelId, userId } = ids;
  const jobId = randomUUID();
  const { error: jobError } = await client.from('capture_jobs').insert({
    id: jobId,
    org_id: orgId,
    model_id: modelId,
    input_kind: 'pdf',
    input_name: INPUT_NAME,
    input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/${INPUT_NAME}`,
    input_sha256: '\\x' + '00'.repeat(32),
    document_date: '2026-06-01',
    created_by: userId,
  });
  if (jobError) throw new Error(`seed job: ${jobError.message}`);
  const { error: dateError } = await service.from('capture_jobs').update({ created_at: createdAt }).eq('id', jobId);
  if (dateError) throw new Error(`seed job date: ${dateError.message}`);

  const main = await getMainBranch(client, modelId);
  if (!main?.head_commit_id) throw new Error('main branch missing');
  const mainHead = foldFromGenesis(main.head_commit_id, await buildCommitLoader(client, modelId));
  const source = await getOrCreateManualSource(client, { id: randomUUID(), orgId, modelId, userId });

  const candidates: CaptureCandidate[] = ['Tractivity', 'Fax Gateway'].map((name, seq) => ({
    id: randomUUID(),
    orgId,
    jobId,
    modelId,
    seq,
    kind: 'element',
    class: 'new',
    elementType: 'system',
    relationshipType: null,
    draftSubjectId: randomUUID(),
    proposal: { kind: 'element', elementType: 'system', name, parent: null, attributes: { lifecycleStatus: 'active', isExternal: false } },
    evidence: { sourceRef: { kind: 'text', start: 0, end: 10 }, passage: name, extractor: 'prose-llm', attributeConfidence: {}, warnings: [] },
    match: { level: 'none', score: 0, similar: [], warnings: [] },
    confidence: 0.7,
    rowKey: `name:system:${name.toLowerCase()}:`,
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
  }));

  const branchId = randomUUID();
  const commitId = randomUUID();
  const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({
    commitId,
    branchId,
    parentCommitId: main.head_commit_id,
    title: `Capture from ${INPUT_NAME}`,
    body: null,
    sourceId: source.id,
    effectiveDate: '2026-06-01',
    mainHead,
    candidates,
    mintId: () => randomUUID(),
  });
  const { error } = await service.schema('atlas').rpc('write_capture_draft', {
    p_job_id: jobId,
    p_branch_id: branchId,
    p_commit_id: commitId,
    p_commit_body: '2 new candidates.',
    p_deltas: envelopeToDeltaRows(envelope, { orgId: '', modelId: '', createdBy: '' }),
    p_candidates: candidates.map((c) => captureCandidateWireToRow({ ...c, draftDeltaIds: draftDeltaIdsBySeq.get(c.seq) ?? [] })),
    p_stats: { candidates: 2, byClass: { new: 2 } },
  } satisfies Record<string, unknown>);
  if (error) throw new Error(`write_capture_draft: ${error.message}`);
  return jobId;
}

test('reject everything by tap and finish the review with no change; discard a duplicate draft from the queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const env = loadEnv();
  const service = createServiceRoleClient(env);

  const email = `capfinish-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const client = createSupabaseClient(env);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(signInError.message);
  const { data: userData } = await client.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('no user');

  const orgId = randomUUID();
  const orgSlug = `capfinish-${orgId.slice(0, 8)}`;
  await createOrganisation(client, { id: orgId, name: 'Capture Finish Org', slug: orgSlug, createdBy: userId });
  const modelId = randomUUID();
  const modelSlug = `capfinish-model-${modelId.slice(0, 8)}`;
  await createModel(client, { id: modelId, orgId, name: 'Capture Finish Model', slug: modelSlug, createdBy: userId });

  const olderJobId = await seedParsedDraft(client, service, { orgId, modelId, userId }, '2026-10-01T10:00:00Z');
  const newerJobId = await seedParsedDraft(client, service, { orgId, modelId, userId }, '2026-10-02T10:00:00Z');

  // The queue offers to keep only the newest draft of a repeated file.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/review`);
  await expect(page.getByRole('heading', { name: 'Capture drafts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review →' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Discard 1 older copy' }).click();
  await page.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(page.getByRole('link', { name: 'Review →' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /older cop/ })).toHaveCount(0);

  const { data: olderJob } = await client.from('capture_jobs').select('status').eq('id', olderJobId).single();
  expect(olderJob).toMatchObject({ status: 'discarded' });

  // Bulk-reject by tap, then finish with no target change.
  await page.getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByRole('heading', { name: 'New (2)' })).toBeVisible();
  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toContainText('2 selected');
  await page.getByRole('button', { name: 'Reject selected' }).click();
  await expect(page.getByText('rejected', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Apply decisions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review$`));
  await expect(page.getByText('No open merge requests.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Capture drafts' })).toHaveCount(0);

  const { data: newerJob } = await client.from('capture_jobs').select('status, target_branch_id').eq('id', newerJobId).single();
  expect(newerJob).toMatchObject({ status: 'reviewed', target_branch_id: null });
  const { count: changeCount } = await client.from('branches').select('id', { count: 'exact', head: true }).eq('model_id', modelId).eq('kind', 'change');
  expect(changeCount).toBe(0);

  // Reopening a finished review shows it closed, not an actionable queue.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/review/capture/${newerJobId}`);
  await expect(page.getByText('This capture review is closed (reviewed).')).toBeVisible();
});
