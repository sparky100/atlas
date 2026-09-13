/**
 * Sprint U4-1 B3: "'Review and link →' opens the browse table filtered to
 * unlinked systems with the supports picker inline per row." Follows the
 * link from the architect door's own Health findings panel, confirms the
 * browse table (ElementsPage.tsx) is scoped to exactly the unlinked
 * systems, then links one directly from its row — no navigating away to
 * the system's own element page — and confirms it drops out of the
 * filtered list once linked.
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

test('Review and link: the browse table filtered to unlinked systems links one inline, without leaving the table', async ({ page }) => {
  const env = loadEnv();

  const email = `browse-filtered-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-browse-filtered fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-browse-filtered fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `browse-filtered-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Browse Filtered Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `browse-filtered-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Browse Filtered Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const linkedSystemId = randomUUID();
  const unlinkedSystemAId = randomUUID();
  const unlinkedSystemBId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one capability, one already-linked system, and two unlinked systems',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Asset Management', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: linkedSystemId, elementType: 'system', name: 'Already Linked System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unlinkedSystemAId, elementType: 'system', name: 'Field Sensor Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unlinkedSystemBId, elementType: 'system', name: 'Outage Notification Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: linkedSystemId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding element-browse-filtered fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('2 systems not linked to a capability')).toBeVisible();

  await page.getByRole('link', { name: /Review and link/ }).click();
  await expect(page.getByRole('heading', { name: 'Elements' })).toBeVisible();

  // Filtered to exactly the two unlinked systems — the already-linked one
  // never shows up here at all.
  await expect(page.getByText('Field Sensor Gateway', { exact: true })).toBeVisible();
  await expect(page.getByText('Outage Notification Service', { exact: true })).toBeVisible();
  await expect(page.getByText('Already Linked System', { exact: true })).toHaveCount(0);

  // Link Field Sensor Gateway directly from its own row — the inline
  // picker, RelationshipAdd.tsx reused verbatim, no navigation away.
  const gatewayRow = page.locator('tr').filter({ hasText: 'Field Sensor Gateway' });
  await gatewayRow.getByRole('button', { name: '+ Add supports' }).click();
  await page.getByPlaceholder('Search…').fill('Asset Management');
  await page.getByRole('button', { name: /Asset Management/ }).click();

  // The very first supports link a system gets is never asked "primary?"
  // (B4) — it's created immediately, and the row drops out of this
  // unlinked-systems-filtered table once it does.
  await expect(page.getByText('Field Sensor Gateway', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Outage Notification Service', { exact: true })).toBeVisible();

  // Confirm it actually landed, not just disappeared from this one filtered
  // view — the system's own element page shows the new supports link.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${unlinkedSystemAId}`);
  await expect(page.getByRole('link', { name: /Asset Management/ })).toBeVisible();
});
