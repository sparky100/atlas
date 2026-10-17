/**
 * Prompt 7h bug fix: "element header '…' menu contains only 'Copy element
 * ID'; Rename is missing (D3 moved it out of the body but didn't add it
 * to the menu). Add Rename to the menu for every element type; renaming
 * writes element.update on name and records the old name as an alias."
 *
 * e2e/element-rename.spec.ts already covers the mechanics (menu-only
 * control, inline rename, cancel) for a capability, which already had
 * Rename before this fix. This is the actual regression test: a System
 * — one of the element types `ElementPage.tsx`'s own `element_type ===
 * 'capability'` gate used to exclude — gets Rename from the menu too,
 * the rename actually lands (new name in a breadcrumb elsewhere in the
 * model), and the old name stays findable by search (the alias
 * `useElementRename.ts` was already recording, just never reachable for
 * anything but a capability until now).
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
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

test('renaming a System from the header menu: new name in the Context breadcrumb, old name still findable by search', async ({ page }) => {
  const env = loadEnv();

  const email = `element-rename-system-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-rename-any-type fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-rename-any-type fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `element-rename-system-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Element Rename System Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `element-rename-system-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Element Rename System Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const oldName = 'Legacy Billing Platform';
  const newName = 'Billing Platform';
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: oldName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${oldName}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding element-rename-any-type fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: oldName })).toBeVisible();

  // The bug itself: before this fix, a non-capability element's "⋯" menu
  // had only "Copy element ID" — no "Rename" at all.
  await page.getByRole('button', { name: 'Element actions' }).click();
  const renameMenuItem = page.getByRole('button', { name: 'Rename', exact: true });
  await expect(renameMenuItem).toBeVisible();
  await renameMenuItem.click();

  const renameInput = page.locator('header').getByRole('textbox');
  await expect(renameInput).toHaveValue(oldName);
  await renameInput.fill(newName);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: newName })).toBeVisible();

  // The new name propagates: Context's own breadcrumb names the system
  // it belongs to (ContextPage.tsx's own `state.data.group.hub.name`) —
  // a real read-path check, not just the element page's own re-render.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}`);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText(newName)).toBeVisible();

  // The old name is still findable by search — `useElementRename.ts`
  // records it as a `name`-type alias, and `matchElements` (src/db/
  // elementSearch.ts) matches on aliases too.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBox.fill(oldName);
  // The search result itself (its link reads "system <name>", glyph first) —
  // Home's recent-activity list links the same element by its bare name too.
  await expect(page.getByRole('link', { name: new RegExp(`^system ${newName}`) })).toBeVisible();
});

test('tapping the title on the element page opens the same inline rename as the menu', async ({ page }) => {
  const env = loadEnv();

  const email = `element-rename-title-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-rename-any-type (title tap) fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-rename-any-type (title tap) fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `element-rename-title-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Element Rename Title Tap Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `element-rename-title-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Element Rename Title Tap Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const actorId = randomUUID();
  const oldName = 'Network Ops Team';
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: oldName, parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${oldName}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding element-rename-any-type (title tap) fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${actorId}`);
  const titleButton = page.getByRole('button', { name: oldName });
  await expect(titleButton).toBeVisible();
  await titleButton.click();

  const renameInput = page.locator('header').getByRole('textbox');
  await expect(renameInput).toHaveValue(oldName);
  await renameInput.fill('Network Control');
  // The rename's own Save, in the header (the Attributes section has its own).
  await page.locator('header').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Network Control' })).toBeVisible();
});
