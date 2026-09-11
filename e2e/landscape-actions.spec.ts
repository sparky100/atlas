/**
 * Sprint U4-1 E1: "Landscape actions collapse to a single '+ Add' menu at
 * 390px."
 *
 * >= 768px (LandscapePage.tsx's own module comment — the app's existing
 * mobile breakpoint, not the sprint's 390px, which is the narrow-mobile
 * floor to prove no horizontal overflow at, same role it plays in
 * e2e/capability-map-layout.spec.ts) keeps "+ Add system" and "+ Add
 * actor" inline, unchanged. Below it the two "Add" controls collapse into
 * one "+ Add" disclosure — checked by visibility, not DOM presence, per
 * the lesson in e2e/element-header.spec.ts/e2e/element-rename.spec.ts (the
 * disclosure's menu items are CSS-hidden, not unmounted, until opened).
 *
 * Sprint U4-2b item 6: "Reset layout" and the "⋯" overflow menu it used to
 * be the only occupant of are gone entirely — the landscape auto-
 * lays-out on every open now, with nothing to reset. This spec dropped
 * every assertion about them rather than leaving a dead "not visible"
 * check for a control that no longer exists at all, at any width.
 *
 * Also covers Sprint U4-1 E2: "header collapsed user menu — verify" —
 * the app header's own mobile user menu (`AppHeader.tsx`/`UserMenu.tsx`,
 * Sprint U3b, unrelated to and untouched by E1) still collapses
 * correctly on the landscape page alongside its own "+ Add" disclosure.
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('landscape actions: "+ Add" collapses into a disclosure below 768px, with no horizontal scroll at 390px', async ({ page }) => {
  const env = loadEnv();

  const email = `landscape-actions-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-actions fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-actions fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-actions-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Actions Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-actions-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Actions Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // A single system so the landscape renders its normal (non-empty-state)
  // actions row — the empty state has its own, separate "Add a system"
  // affordance, not this item's concern.
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: randomUUID(), elementType: 'system', name: 'Billing', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a system',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-actions fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await expect(page.getByText('Billing')).toBeVisible();

  // >= 768px: both controls sit inline, no disclosure involved.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole('button', { name: '+ Add system' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add actor' })).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // < 768px: both collapse into one "+ Add" disclosure — neither sits in
  // the row directly any more.
  await page.setViewportSize({ width: 390, height: 800 });
  const addToggle = page.getByRole('button', { name: '+ Add', exact: true });
  await expect(addToggle).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add system' })).not.toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // The "+ Add" disclosure reveals both add controls in place.
  await addToggle.click();
  await expect(page.getByRole('button', { name: '+ Add system' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add actor' })).toBeVisible();

  // Sprint U4-1 E2: the app header's own mobile menu, a separate
  // component from Landscape's own "+ Add" disclosure above, still
  // collapses correctly here too — opening it disturbs neither.
  const appMenuToggle = page.getByRole('button', { name: 'Account menu' });
  await expect(appMenuToggle).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  await appMenuToggle.click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add system' })).toBeVisible();
});
