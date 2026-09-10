/**
 * Prompt 7h bug fix: "the search-first create option disappears when any
 * partial match exists." Rule: "Create '<typed>' as [type]" is always the
 * last row unless there is an exact, case-insensitive match on a name or
 * alias; near-matches are listed above it. Applies to HomeSearch and
 * ElementSearchAdd (the relationship target picker has no create concept
 * at all — no change needed there, and nothing to test).
 *
 * Same "needs a real Supabase" limitation as every Playwright test in
 * this repo — seeds one capability via the real commitToBranch path from
 * Node, then drives the actual search box through the browser.
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

const EXISTING_NAME = 'Enterprise Architecture & Standards';

test('HomeSearch: create stays visible (last row) alongside a near-match, and hides only on an exact match', async ({ page }) => {
  const env = loadEnv();

  const email = `search-create-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`search-create-row-ordering fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`search-create-row-ordering fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `search-create-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Search Create Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `search-create-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Search Create Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: randomUUID(), elementType: 'capability', name: EXISTING_NAME, parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${EXISTING_NAME}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding search-create-row-ordering fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeVisible();

  // A partial match ("Enter") — the near-match still shows, and so does
  // "Create...", as the last row below it (this is the exact bug: it used
  // to disappear the moment any match existed at all). Scoped to a
  // result row specifically (a plain `<li>` containing both the name and
  // "relationship" — `HomeSearch.tsx`'s own result-row shape): the seed
  // commit's own title ("seed Enterprise Architecture & Standards") and
  // other page furniture also contain this name as a substring.
  await searchBox.fill('Enter');
  const matchLink = page.locator('li').filter({ hasText: EXISTING_NAME }).filter({ hasText: 'relationship' });
  await expect(matchLink).toBeVisible();
  const createButton = page.getByRole('button', { name: /^Create / });
  await expect(createButton).toBeVisible();
  // "Last row": the create control's own container sits below the match
  // in the DOM/visually — its top is further down the page than the
  // match's own row.
  const [matchBox, createBox] = await Promise.all([matchLink.boundingBox(), createButton.boundingBox()]);
  if (!matchBox || !createBox) throw new Error('match or create row has no bounding box');
  expect(createBox.y).toBeGreaterThan(matchBox.y);

  // The exact name, case-insensitive — create disappears; the match alone
  // still shows.
  await searchBox.fill(EXISTING_NAME.toLowerCase());
  await expect(matchLink).toBeVisible();
  await expect(page.getByRole('button', { name: /^Create / })).toHaveCount(0);
});

test('ElementSearchAdd ("+ Add system" on Landscape): same rule — create stays visible alongside a near-match, hides only on an exact match', async ({ page }) => {
  const env = loadEnv();

  const email = `search-create-esa-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`search-create-row-ordering (ElementSearchAdd) fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`search-create-row-ordering (ElementSearchAdd) fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `search-create-esa-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Search Create ESA Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `search-create-esa-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Search Create ESA Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const existingSystemName = 'Billing Service';
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: randomUUID(), elementType: 'system', name: existingSystemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${existingSystemName}`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding search-create-row-ordering (ElementSearchAdd) fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await page.getByRole('button', { name: '+ Add system' }).click();
  const searchBox = page.getByPlaceholder('Search or create a system…');
  await expect(searchBox).toBeVisible();

  // A partial match ("Billing") — the near-match still shows, and so does
  // "Create...", as the last row below it.
  await searchBox.fill('Billing');
  await expect(page.getByText(existingSystemName)).toBeVisible();
  const createButton = page.getByRole('button', { name: /^Create / });
  await expect(createButton).toBeVisible();
  const [matchBox, createBox] = await Promise.all([page.getByText(existingSystemName).boundingBox(), createButton.boundingBox()]);
  if (!matchBox || !createBox) throw new Error('match or create row has no bounding box');
  expect(createBox.y).toBeGreaterThan(matchBox.y);

  // The exact name, case-insensitive — create disappears; the match alone
  // still shows.
  await searchBox.fill(existingSystemName.toLowerCase());
  await expect(page.getByText(existingSystemName)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Create / })).toHaveCount(0);
});
