/**
 * Prompt 7h bug fix: "Comment header: display name once, handle only
 * when different." `CommentThread.tsx`'s own `CommentRowView` used to
 * show `@handle` unconditionally alongside `authorLabel`'s own text —
 * `authorLabel` already falls back to `@handle` itself when there's no
 * display name, so an author with no display name yet read as "@handle
 * @handle" (the same string, twice) rather than once.
 *
 * Same "needs a real Supabase" limitation as e2e/comments.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { getProfile, updateMyProfile } from '../src/db/profiles';
import { loadEnv, type Env } from '../src/db/env';

async function signUpAndSeedOrgModel(page: Page, env: Env, slugPrefix: string) {
  const email = `${slugPrefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`${slugPrefix} fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`${slugPrefix} fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `${slugPrefix}-${orgId.slice(0, 8)}`;
  // Node-side, not through Home's own "New organisation" form — this
  // fixture is about what the comment header shows, not the Home page's
  // own Prompt 7h display-name gate (e2e/org-and-model-home.spec.ts
  // covers that), so it deliberately never revisits Home after this,
  // leaving the profile `atlas.ensure_profile` created exactly as that
  // trigger left it: a handle, no display name, unless a test below
  // explicitly sets one.
  await createOrganisation(signedIn, { id: orgId, name: `${slugPrefix} Org`, slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `${slugPrefix}-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: `${slugPrefix} Model`, slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const systemName = `${slugPrefix} System`;
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${systemName}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding ${slugPrefix} fixture: ${seedResult.message}`);

  return { signedIn, userId, orgSlug, modelSlug, systemId, systemName };
}

test('comment header: an author with no display name shows @handle once, not twice', async ({ page }) => {
  const env = loadEnv();
  const { orgSlug, modelSlug, systemId, systemName } = await signUpAndSeedOrgModel(page, env, 'comment-identity-nohandle');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: systemName })).toBeVisible();

  const commentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await commentsSection.scrollIntoViewIfNeeded();
  const body = 'No display name set yet — how does this look?';
  await commentsSection.getByPlaceholder('Write a comment…').fill(body);
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  await expect(commentsSection.getByText(body)).toBeVisible();

  const commentRow = commentsSection.locator('div').filter({ hasText: body }).last();
  // `authorLabel` itself already reads "@<handle>" here (no display name
  // to prefer) — the bug was the row showing that same text a second
  // time in the muted secondary line right next to it.
  await expect(commentRow.getByText(/^@/)).toHaveCount(1);
});

test('comment header: an author with a display name shows it once, plus @handle since it differs', async ({ page }) => {
  const env = loadEnv();
  const { signedIn, userId, orgSlug, modelSlug, systemId, systemName } = await signUpAndSeedOrgModel(page, env, 'comment-identity-withname');

  const displayName = 'Priya Shah';
  await updateMyProfile(signedIn, { userId, displayName });
  const profile = await getProfile(signedIn, userId);
  if (!profile) throw new Error('profile was not created by atlas.ensure_profile');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: systemName })).toBeVisible();

  const commentsSection = page.locator('section').filter({ has: page.getByRole('button', { name: /^Comments/ }) });
  await commentsSection.scrollIntoViewIfNeeded();
  const body = 'Display name is set now — how does this look?';
  await commentsSection.getByPlaceholder('Write a comment…').fill(body);
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  await expect(commentsSection.getByText(body)).toBeVisible();

  const commentRow = commentsSection.locator('div').filter({ hasText: body }).last();
  await expect(commentRow.getByText(displayName, { exact: true })).toBeVisible();
  await expect(commentRow.getByText(`@${profile.handle}`, { exact: true })).toBeVisible();
});
