/**
 * Sprint U4-1 C4: "default colour-by. Exposure for director home mode,
 * coverage for architect; 'None' only while the model has no systems,
 * with hint 'link systems to capabilities to see coverage'; remember
 * last choice per user."
 *
 * Same "needs a real Supabase" limitation as e2e/capability-map.spec.ts.
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

async function signUpAndCreateOrgAndModel(page: Page, env: ReturnType<typeof loadEnv>, slugPrefix: string) {
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
  await createOrganisation(signedIn, { id: orgId, name: `${slugPrefix} Test Org`, slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `${slugPrefix}-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: `${slugPrefix} Test Model`, slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error(`${slugPrefix} fixture: main branch was not auto-created`);

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`${slugPrefix} seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const sourceId = (sourceRow as { id: string }).id;

  return { signedIn, orgId, orgSlug, modelId, modelSlug, main, sourceId };
}

test('colour-by defaults to None (with hint) while the model has no systems, and to Coverage for an owner/architect once it does', async ({ page }) => {
  const env = loadEnv();
  const { signedIn, orgSlug, modelId, modelSlug, main, sourceId } = await signUpAndCreateOrgAndModel(page, env, 'capmap-colourby-none');

  const capId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one capability, no systems at all yet',
    body: null,
    deltas: [{ kind: 'element.create', id: randomUUID(), elementId: capId, elementType: 'capability', name: 'Finance', parentId: null, attributes: {}, sourceId, confidence: 1 }],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capmap-colourby-none fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Finance')).toBeVisible();

  await expect(page.getByLabel('Colour by')).toHaveValue('none');
  await expect(page.getByText('Link systems to capabilities to see coverage.')).toBeVisible();

  // Now the model gets a real system, linked to Finance.
  const systemId = randomUUID();
  const { data: mainRow } = await signedIn.from('branches').select('head_commit_id').eq('id', main.id).single();
  const headCommitId = (mainRow as { head_commit_id: string }).head_commit_id;
  const addSystemDeltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Ledger', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capId, attributes: { role: 'primary' }, sourceId, confidence: 1 },
  ];
  const addSystemResult = await commitToBranch(signedIn, {
    modelId,
    branchId: main.id,
    expectedHeadCommitId: headCommitId,
    envelope: {
      id: randomUUID(),
      branchId: main.id,
      parentCommitId: headCommitId,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'add a system supporting Finance',
      body: null,
      deltas: addSystemDeltas,
    },
  });
  if (!addSystemResult.ok) throw new Error(`adding a system to capmap-colourby-none fixture: ${addSystemResult.message}`);

  await page.reload();
  await expect(page.getByLabel('Colour by')).toHaveValue('metric:supportingSystemCount');
  await expect(page.getByText('Link systems to capabilities to see coverage.')).toHaveCount(0);
});

test('colour-by remembers the last choice per user, across a reload, instead of reverting to the smart default', async ({ page }) => {
  const env = loadEnv();
  const { signedIn, orgSlug, modelId, modelSlug, main, sourceId } = await signUpAndCreateOrgAndModel(page, env, 'capmap-colourby-remember');

  const capId = randomUUID();
  const systemId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one capability with a supporting system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capId, elementType: 'capability', name: 'Finance', parentId: null, attributes: {}, sourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Ledger', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capId, attributes: { role: 'primary' }, sourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capmap-colourby-remember fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Finance')).toBeVisible();

  // Starts at the smart default: an owner/architect on a model with real
  // systems defaults to Coverage.
  await expect(page.getByLabel('Colour by')).toHaveValue('metric:supportingSystemCount');

  await page.getByLabel('Colour by').selectOption({ label: 'Lifecycle exposure' });
  await expect(page.getByLabel('Colour by')).toHaveValue('metric:lifecycleExposure');

  await page.reload();

  // Still exposure, not back to the Coverage default — the saved choice
  // wins over resolveDefaultColourBy's own context-based logic.
  await expect(page.getByLabel('Colour by')).toHaveValue('metric:lifecycleExposure');
});
