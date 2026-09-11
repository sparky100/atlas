/**
 * Sprint U4-1 D3: "Rename. Move into Edit mode or the header menu; no
 * stray control between Edit and Attributes."
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('element rename: no standalone "Rename" control; the header menu opens it in place of the static title', async ({ page }) => {
  const env = loadEnv();

  const email = `element-rename-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-rename fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-rename fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `element-rename-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Element Rename Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `element-rename-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Element Rename Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Finance', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a leaf capability',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding element-rename fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${capabilityId}`);
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();

  // No stray control between Edit and Attributes at all any more (Prompt
  // 7k item 5 folded the old standalone "Retract" button into this same
  // header menu, generalised to "Remove from model…") — "Rename" is
  // CSS-hidden (same collapsed-by-default shape as "Copy element ID", D1's
  // own menu item) until the menu opens, checked by visibility, not DOM
  // presence, since it's still in the DOM either way.
  const renameMenuItem = page.getByRole('button', { name: 'Rename', exact: true });
  await expect(renameMenuItem).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove from model…' })).not.toBeVisible();

  // The header menu is where both live now.
  await page.getByRole('button', { name: 'Element actions' }).click();
  await expect(renameMenuItem).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove from model…' })).toBeVisible();
  await renameMenuItem.click();

  // Picking it swaps the static h1 for an inline input, right where the
  // name was — not a separate row. Scoped to the `<header>` (a plain HTML
  // landmark, not a CSS-module class — ElementHeader.tsx's own root tag):
  // a bare `getByRole('textbox')` also matches the Comments section's own
  // always-open "Write a comment…" textarea further down the same page.
  await expect(page.getByRole('heading', { name: 'Finance' })).toHaveCount(0);
  const renameInput = page.locator('header').getByRole('textbox');
  await expect(renameInput).toHaveValue('Finance');

  await renameInput.fill('Financial Management');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Financial Management' })).toBeVisible();

  // Cancelling a second rename leaves the name untouched.
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.locator('header').getByRole('textbox').fill('Something Else Entirely');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Financial Management' })).toBeVisible();
});
