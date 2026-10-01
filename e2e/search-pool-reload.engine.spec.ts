/**
 * Sprint U4-1 A1 (reproduced): a page's search-first "Add" reads
 * `elements_head`/`aliases` filtered to a specific `commit_id` — the model's
 * `main` head at the moment the pool was fetched (`src/db/elementSearch.ts`).
 * `elements_head` only ever holds rows for `main`'s *current* head (SPEC §1
 * S-2/P-6), not one snapshot per historical commit, so once another commit
 * moves that head, the old `commit_id` a page handed to
 * `useRelationshipTargetSearch`/`useElementSearchAdd`/`useHomeSearch` has
 * zero rows left — not stale rows, none at all. Before this fix, none of
 * `ElementPage.tsx`/`LandscapePage.tsx` (via `useMainBranch`) ever refreshed
 * that commit id after a commit landed from the same page visit, so the
 * *next* search on the same page found nothing, for names that plainly
 * exist — until the page was left and reloaded.
 *
 * Same "needs a real Supabase" setup as e2e/element-edit.spec.ts's own
 * module comment: seeds elements directly via `commitToBranch`, then drives
 * the actual repro through the browser.
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

async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
}

test('an element page finds an existing element to relate after adding a relationship, without leaving the page', async ({ page }) => {
  const env = loadEnv();

  const email = `search-reload-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await signUp(page, email, password);

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`search-pool-reload fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`search-pool-reload fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `search-reload-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Search Reload Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `search-reload-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Search Reload Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // One capability (the "supported by" side, per the bug's own repro
  // wording) and two systems already on `main` before the test ever opens
  // the element page — both must still be findable after the first add.
  const capabilityId = randomUUID();
  const billingServiceId = randomUUID();
  const paymentGatewayId = randomUUID();
  const seedDeltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Order Management', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: billingServiceId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: paymentGatewayId, elementType: 'system', name: 'Payment Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const seedEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed capability and two systems', body: null, deltas: seedDeltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability/systems: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${capabilityId}`);
  await expect(page.getByRole('heading', { name: 'Order Management' })).toBeVisible();

  // First add: Billing Service. This is the commit that moves `main`'s
  // head — the exact moment the bug's stale `searchCommitId` stopped
  // pointing at a commit `elements_head` still had rows for.
  await page.getByRole('button', { name: '+ Add supported by' }).click();
  await page.getByPlaceholder('Search…').fill('Billing');
  await page.getByRole('button', { name: /Billing Service/ }).click();
  await expect(page.getByRole('link', { name: 'Billing Service' })).toBeVisible();

  // Second add, same page, no reload/navigation in between: Payment Gateway
  // was already on `main` before either add — before this fix, this search
  // found nothing at all.
  await page.getByRole('button', { name: '+ Add supported by' }).click();
  await page.getByPlaceholder('Search…').fill('Payment');
  // Auto-waiting is the real assertion: before this fix, this result never
  // appeared at all (the pool's `commit_id` had zero rows), so this click
  // would time out rather than find a stale match.
  await page.getByRole('button', { name: /Payment Gateway/ }).click();

  await expect(page.getByRole('link', { name: 'Billing Service' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Payment Gateway' })).toBeVisible();
});

test('the landscape finds a just-created system when adding a second one', async ({ page }) => {
  const env = loadEnv();

  const email = `search-reload-landscape-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await signUp(page, email, password);

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`search-pool-reload landscape fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`search-pool-reload landscape fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `search-reload-landscape-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Search Reload Landscape Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `search-reload-landscape-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Search Reload Landscape Model', slug: modelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);

  // First system, via the empty-state control — creating navigates to its
  // own element page (ElementSearchAdd's own behaviour).
  await page.getByRole('button', { name: 'Add a system' }).click();
  await page.getByPlaceholder('Search or create a system…').fill('Alpha System');
  await page.getByRole('button', { name: 'Create system "Alpha System"' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha System' })).toBeVisible();

  // Back to the Landscape through the app's own persistent nav (not a hard
  // page.goto) — an in-app route change, same as a user clicking around.
  await page.getByRole('navigation', { name: 'Model navigation' }).getByRole('link', { name: 'Landscape' }).click();
  await expect(page.getByRole('button', { name: '+ Add system' })).toBeVisible();

  // Second system: search first, for the system the first add just
  // created, to prove the pool this page now searches against actually
  // reflects the commit that add made — not a snapshot from before it.
  await page.getByRole('button', { name: '+ Add system' }).click();
  await page.getByPlaceholder('Search or create a system…').fill('Alpha');
  await expect(page.getByRole('link', { name: /Alpha System/ })).toBeVisible();

  await page.getByPlaceholder('Search or create a system…').fill('Beta System');
  await page.getByRole('button', { name: 'Create system "Beta System"' }).click();
  await expect(page.getByRole('heading', { name: 'Beta System' })).toBeVisible();
});
