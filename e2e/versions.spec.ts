/**
 * Versions' core user path (Sprint U2 step 4, CLAUDE.md's sprint DoD): tag
 * main with a name and note, see it in the version list, open it read-only
 * at its own ref, and diff two tagged versions and see what changed.
 *
 * Same "needs a real Supabase" limitation, and the same genesis-commit
 * bootstrap, as e2e/element-edit.spec.ts (see that file's own comment).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createServiceRoleClient, createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('versions: tag main, open a tag read-only, and diff two tags', async ({ page }) => {
  const env = loadEnv();

  const email = `versions-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`versions fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`versions fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `versions-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Versions Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `versions-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Versions Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const service = createServiceRoleClient(env);
  const genesisCommitId = randomUUID();
  const { error: genesisError } = await service
    .from('commits')
    .insert({ id: genesisCommitId, org_id: orgId, model_id: modelId, branch_id: main.id, parent_commit_id: null, kind: 'manual', message: 'seed', author_id: userId, depth: 0 });
  if (genesisError) throw new Error(`genesis commit: ${genesisError.message}`);
  const { error: headError } = await service.from('branches').update({ head_commit_id: genesisCommitId }).eq('id', main.id);
  if (headError) throw new Error(`advancing main head: ${headError.message}`);

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // v1: one System.
  const systemAId = randomUUID();
  const v1Envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    message: 'add System A',
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: systemAId, elementType: 'system', name: 'System A', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const v1Result = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: v1Envelope });
  if (!v1Result.ok) throw new Error(`seeding v1: ${v1Result.message}`);
  const v1CommitId = v1Result.commitId;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/versions`);
  // Scoped to the version list itself, not the page as a whole: once a tag
  // exists, the "compare two versions" picker also renders an <option>
  // with the same text, and a bare page-wide `getByText` would match both.
  const versionList = page.getByRole('list');
  await page.getByPlaceholder('Version name (e.g. v2026-Q2)').fill('v1');
  await page.getByPlaceholder('Note (optional)').fill('First cut');
  await page.getByRole('button', { name: 'Tag main now' }).click();
  await expect(versionList.getByText('v1', { exact: true })).toBeVisible();
  await expect(versionList.getByText('First cut')).toBeVisible();

  // v2: add System B on top of v1 — a real change to diff against.
  const systemBId = randomUUID();
  const v2Deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemBId, elementType: 'system', name: 'System B', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const v2Envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: v1CommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    message: 'add System B',
    deltas: v2Deltas,
  };
  const v2Result = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: v1CommitId, envelope: v2Envelope });
  if (!v2Result.ok) throw new Error(`seeding v2: ${v2Result.message}`);

  await page.reload();
  await page.getByPlaceholder('Version name (e.g. v2026-Q2)').fill('v2');
  await page.getByRole('button', { name: 'Tag main now' }).click();
  await expect(versionList.getByText('v2', { exact: true })).toBeVisible();

  // Open v1 read-only: the ref lands in the URL and the page renders (no
  // "no commits yet at this ref" — that only happens if the ref failed to
  // resolve).
  const v1Row = versionList.locator('li', { hasText: 'v1' });
  await v1Row.getByRole('link', { name: 'Open →' }).click();
  await expect(page).toHaveURL(/ref=tag%3Av1|ref=tag:v1/);
  await expect(page.getByText('no commits yet at this ref')).toHaveCount(0);

  // Diff v1 → v2: System B should show as Added, System A as Unchanged
  // (implicitly — it's not listed, since Unchanged rows are counted, not
  // shown; see VersionDiffView.tsx's own comment on why).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/versions`);
  await page.getByRole('combobox').first().selectOption('tag:v2');
  await page.getByRole('combobox').last().selectOption('tag:v1');
  await page.getByRole('link', { name: 'Diff →' }).click();

  await expect(page.getByRole('heading', { name: 'Diff: v1 → v2' })).toBeVisible();
  await expect(page.getByText('System B')).toBeVisible();
  // .first(): the badge's accessible text duplicates across an icon +
  // label pair in the same row — this checks the badge renders at all.
  await expect(page.getByText('Added').first()).toBeVisible();
  await expect(page.getByText('System A')).toHaveCount(0);
});
