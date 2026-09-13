/**
 * M1 close-out item 4: "Unresolved counts on the browse table rows."
 * `ElementBrowseTable.tsx`'s own new "Comments" column — a system with an
 * open thread shows its count, one with no comments (or every thread
 * resolved) shows a plain dash, same convention every other empty cell in
 * this table already uses.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { createComment } from '../src/db/comments';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('element browse table: a row with an open thread shows its unresolved count, a row with none shows a dash', async ({ page }) => {
  const env = loadEnv();

  const email = `browse-unresolved-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`browse-unresolved fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`browse-unresolved fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `browse-unresolved-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Browse Unresolved Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `browse-unresolved-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Browse Unresolved Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const commentedSystemId = randomUUID();
  const quietSystemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: commentedSystemId, elementType: 'system', name: 'Has Open Comments', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: quietSystemId, elementType: 'system', name: 'Has No Comments', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two systems for the browse-unresolved test',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding browse-unresolved fixture: ${seedResult.message}`);

  await createComment(signedIn, { id: randomUUID(), orgId, modelId, anchorType: 'element', anchorId: commentedSystemId, body: 'Needs a second look.', authorId: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);
  await expect(page.getByRole('heading', { name: 'Elements' })).toBeVisible();

  const commentedRow = page.locator('tr').filter({ hasText: 'Has Open Comments' });
  await expect(commentedRow).toBeVisible();
  await expect(commentedRow.getByText('💬 1')).toBeVisible();

  const quietRow = page.locator('tr').filter({ hasText: 'Has No Comments' });
  await expect(quietRow).toBeVisible();
  await expect(quietRow.getByText('💬', { exact: false })).toHaveCount(0);
});
