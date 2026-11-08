/**
 * Sprint U4-1 B5: `flows_to` requires a verb-phrase label at creation, the
 * same as `uses` (covered for `uses` by e2e/element-creation.spec.ts's own
 * flow — this file exercises the second type plus the two things that
 * flow needs on top of it: cancelling mid-label returns to the search step
 * rather than closing the whole control, and the bugfix this sprint item
 * found while widening RelationshipAdd.tsx's `pickResult` — adding an
 * owner through "+ Add owned by" now actually gets `primary: true`
 * (previously it silently got `{ role: 'secondary' }`, a `supports`-only
 * attribute `OwnsAttributes` doesn't have, and never showed the ★ primary
 * badge or counted toward "capabilities/systems with no owner").
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('flows_to requires a label; cancelling the label step returns to search; adding an owner records its role', async ({ page }) => {
  const env = loadEnv();

  const email = `verb-label-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`relationship-verb-label fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`relationship-verb-label fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `verb-label-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Verb Label Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `verb-label-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Verb Label Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const meterReadingId = randomUUID();
  const billingPlatformId = randomUUID();
  const gridSensorArrayId = randomUUID();
  const actorId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two systems for flows_to and a system/actor pair for owns',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: meterReadingId, elementType: 'system', name: 'Meter Reading Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: billingPlatformId, elementType: 'system', name: 'Billing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: gridSensorArrayId, elementType: 'system', name: 'Grid Sensor Array', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Network Control', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding relationship-verb-label fixture: ${seedResult.message}`);

  // --- flows_to: cancel mid-label returns to search, then a real label sticks ---
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${meterReadingId}`);
  await expect(page.getByRole('heading', { name: 'Meter Reading Service' })).toBeVisible();

  await page.getByRole('button', { name: '+ Add flows to' }).click();
  await page.getByPlaceholder('Search…').fill('Billing Platform');
  await page.getByRole('button', { name: /Billing Platform/ }).click();

  // "Back" (not "Cancel", which closes the whole control) goes back to
  // search — the search box (not the "+ Add flows to" button) is what's
  // visible next. Pre-existing test/component naming mismatch found
  // while touching this same file for check C2: the label step's own two
  // buttons are "Back" (→ cancelPending, search) and "Cancel" (→ close,
  // the whole control) — this test asserted on "Cancel" but described
  // "Back"'s actual behaviour.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByPlaceholder('Search…')).toBeVisible();

  await page.getByPlaceholder('Search…').fill('Billing Platform');
  await page.getByRole('button', { name: /Billing Platform/ }).click();
  // The verb phrase is required: "Next" stays disabled until it's typed,
  // then the via-platform stage follows (a direct edge here).
  const addLabelButton = page.getByRole('button', { name: 'Next' });
  await expect(addLabelButton).toBeDisabled();
  await page.getByPlaceholder('e.g. reads customer records from').fill('sends interval reads to');
  await addLabelButton.click();
  await page.getByRole('button', { name: 'Skip — link directly' }).click();

  await expect(page.getByRole('link', { name: /Billing Platform/ })).toBeVisible();
  await expect(page.getByText('“sends interval reads to”')).toBeVisible();

  // --- owns: adding an owner through "+ Add owned by" records its role (Prompt 7k item 2 replaced the old primary flag with business/technical/service) ---
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${gridSensorArrayId}`);
  await expect(page.getByRole('heading', { name: 'Grid Sensor Array' })).toBeVisible();

  await page.getByRole('button', { name: '+ Add owned by' }).click();
  await page.getByPlaceholder('Search…').fill('Network Control');
  await page.getByRole('button', { name: /Network Control/ }).click();

  // No verb-phrase prompt for owns (that's uses/flows_to only); on a system
  // target it asks which kind of owner instead, and the row shows that role.
  await page.getByRole('button', { name: 'Technical' }).click();
  await expect(page.getByRole('link', { name: /Network Control/ })).toBeVisible();
  await expect(page.getByText('technical owner', { exact: true })).toBeVisible();
});
