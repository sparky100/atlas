/**
 * Handoff — Flow: Add a system (`docs/HANDOFF-add-a-system-flow.md`), built
 * to the user's eight numbered decisions on top of the corrected handoff:
 * `HomeSearch` cited as the real front door, autofocus on the architect
 * door only, a type select inside the create option, rich near-match rows,
 * the branch variant (active-ref create, propose-a-change for a
 * contributor at main), the verb phrase on `uses`/`flows_to`, the
 * capability picker reusing `useRelationshipTargetSearch`, and the
 * `supports` relationship riding the create's own commit.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

async function signUp(page: Page, prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  return { email, password };
}

test('add a system: search finds nothing, the create sheet asks description and capability, supports rides the same commit, and a uses relationship gets a verb phrase and a just-added chip', async ({ page }) => {
  const env = loadEnv();
  const { email, password } = await signUp(page, 'add-system-owner');

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`add-a-system fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`add-a-system fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `add-system-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Add A System Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `add-system-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Add A System Test Model', slug: modelSlug, createdBy: userId });

  // A capability and a second system to link against, seeded through the
  // real commit path (ADR-018 — main already has a genesis commit).
  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const otherSystemId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability and a second system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Revenues & Benefits', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: otherSystemId, elementType: 'system', name: 'Council Tax System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding add-a-system fixture: ${seedResult.message}`);

  // Step 1: the front door's search box, autofocused (decision 2 — the
  // org's own creator is its owner, so the architect door is the default).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeVisible();
  await expect(searchBox).toBeFocused();

  // Step 2/3: "Northgate" has no exact match — the create option appears,
  // type select defaulting to system (decision 3).
  await searchBox.fill('Northgate');
  const typeSelect = page.getByRole('combobox');
  await expect(typeSelect).toHaveValue('system');
  await page.getByRole('button', { name: 'Create system "Northgate"' }).click();

  // Step 4: the one sheet — description required, capability picker reused
  // from useRelationshipTargetSearch (decision 7).
  await expect(page.getByText('Description (required)')).toBeVisible();
  await page.getByPlaceholder('One line — what this system is').fill('The borough’s new revenues platform.');
  await page.getByPlaceholder('Search capabilities…').fill('Revenues');
  await page.getByRole('button', { name: 'Revenues & Benefits' }).click();
  await expect(page.getByText('Supports Revenues & Benefits')).toBeVisible();
  await expect(page.getByText(/Written as manual/)).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  // Step 5: the new element page — description, lifecycle/external
  // defaults, and the supports link, all written in the create's own
  // commit (decision 8: no follow-up commit needed for the capability).
  await expect(page.getByRole('heading', { name: 'Northgate' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Revenues & Benefits/ })).toBeVisible();

  // The post-create toast (step 7's own affordance, shown immediately here
  // since it reads router state set on navigation).
  await expect(page.getByText('Northgate added.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add another system →' })).toBeVisible();

  // Step 6: "+ Add" under Uses — target picker, then the verb phrase
  // (decision 6), both in the same overlay.
  await page.getByRole('button', { name: '+ Add uses' }).click();
  await page.getByPlaceholder('Search…').fill('Council Tax');
  await page.getByRole('button', { name: /Council Tax System/ }).click();
  await expect(page.getByText('Verb phrase')).toBeVisible();
  await page.getByPlaceholder('e.g. reads customer records from').fill('shares address data with');
  // Since Prompt 7k: after the verb phrase, a second stage asks whether the
  // link goes via an integration platform — a direct edge here.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Skip — link directly' }).click();

  // Step 7: the relationship shows its phrase and a just-added chip.
  await expect(page.getByText('“shares address data with”')).toBeVisible();
  await expect(page.getByText('just added')).toBeVisible();
  await expect(page.getByRole('link', { name: /Council Tax System/ })).toBeVisible();
});

test('add a system on a change branch: a contributor at main gets the propose-a-change picker, and the system lands planned on that change', async ({ page, browser }) => {
  const env = loadEnv();
  const { email: ownerEmail, password: ownerPassword } = await signUp(page, 'add-system-owner-b');

  const owner = createSupabaseClient(env);
  const { error: ownerSignInError } = await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
  if (ownerSignInError) throw new Error(`add-a-system branch fixture owner sign-in: ${ownerSignInError.message}`);
  const { data: ownerData, error: getOwnerError } = await owner.auth.getUser();
  if (getOwnerError) throw new Error(`add-a-system branch fixture: could not read the owner user: ${getOwnerError.message}`);
  const ownerId = ownerData.user.id;

  const orgId = randomUUID();
  const orgSlug = `add-system-branch-${orgId.slice(0, 8)}`;
  await createOrganisation(owner, { id: orgId, name: 'Add A System Branch Test Org', slug: orgSlug, createdBy: ownerId });

  const modelId = randomUUID();
  const modelSlug = `add-system-branch-model-${modelId.slice(0, 8)}`;
  await createModel(owner, { id: modelId, orgId, name: 'Add A System Branch Test Model', slug: modelSlug, createdBy: ownerId });

  // A second user, made a contributor on the owner's org (`members_insert`'s
  // RLS lets an owner insert any member row) — decision 5's propose-a-
  // change path only applies to a contributor, not an owner/architect.
  const contributorContext = await browser.newContext();
  const contributorPage = await contributorContext.newPage();
  const { email: contributorEmail, password: contributorPassword } = await signUp(contributorPage, 'add-system-contributor');
  const contributorAuth = createSupabaseClient(env);
  const { error: contributorSignInError } = await contributorAuth.auth.signInWithPassword({ email: contributorEmail, password: contributorPassword });
  if (contributorSignInError) throw new Error(`add-a-system branch fixture contributor sign-in: ${contributorSignInError.message}`);
  const { data: contributorData, error: getContributorError } = await contributorAuth.auth.getUser();
  if (getContributorError) throw new Error(`add-a-system branch fixture: could not read the contributor user: ${getContributorError.message}`);
  const contributorId = contributorData.user.id;

  const { error: memberError } = await owner.from('members').insert({ org_id: orgId, user_id: contributorId, role: 'contributor', invited_by: ownerId });
  if (memberError) throw new Error(`add-a-system branch fixture: could not add contributor: ${memberError.message}`);

  await contributorPage.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const searchBox = contributorPage.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeVisible();
  await searchBox.fill('Southgate');
  await contributorPage.getByRole('button', { name: 'Create system "Southgate"' }).click();

  // Decision 5: a contributor viewing main has no direct create-on-main —
  // the propose-a-change picker appears instead of the description sheet.
  await expect(contributorPage.getByText('You can propose this as part of a change, not add it to the live model directly.')).toBeVisible();
  await contributorPage.getByPlaceholder('Name (e.g. retire-northgate)').fill('retire-southgate');
  await contributorPage.getByRole('button', { name: 'Create & continue' }).click();

  // Resolving the picker reveals the description sheet, kicker'd to the
  // change just proposed.
  await expect(contributorPage.getByText('Adding to change: retire-southgate')).toBeVisible();
  await contributorPage.getByPlaceholder('One line — what this system is').fill('A pilot for the southern gate.');
  await contributorPage.getByRole('button', { name: 'Skip capability' }).click();

  // The system lands on the change branch, not main — lifecycle defaults
  // to `planned` there (defaultCreateAttributes's own onMain rule).
  await expect(contributorPage.getByRole('heading', { name: 'Southgate' })).toBeVisible();
  await expect(contributorPage).toHaveURL(/ref=branch:/);
  await expect(contributorPage.getByText('planned', { exact: true }).first()).toBeVisible();

  await contributorContext.close();
});

test('add a system at 390px: the create sheet is pinned full-width at the viewport bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const env = loadEnv();
  const { email, password } = await signUp(page, 'add-system-mobile');
  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`add-a-system mobile fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`add-a-system fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `add-system-mobile-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Add A System Mobile Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `add-system-mobile-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Add A System Mobile Test Model', slug: modelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeVisible();
  await searchBox.fill('Eastgate');
  await page.getByRole('button', { name: 'Create system "Eastgate"' }).click();

  const sheet = page.getByTestId('add-system-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('position', 'fixed');

  await page.getByPlaceholder('One line — what this system is').fill('A mobile-created system.');
  await page.getByRole('button', { name: 'Skip capability' }).click();
  await expect(page.getByRole('heading', { name: 'Eastgate' })).toBeVisible();

  const toast = page.getByTestId('add-system-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS('position', 'fixed');
});
