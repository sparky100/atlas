/**
 * Sprint U4-2b item 13: "Landscape on mobile (<768px): render a list, not
 * the canvas... Playwright at 390px: groups render, expand one, tap a
 * system." Unlike every other landscape e2e spec, this one *is* real DOM
 * (`LandscapeMobileList.tsx`'s own module comment) — no canvas coordinate
 * math needed, plain `getByRole` throughout.
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

test('landscape mobile list at 390px: groups render (actors first), expanding one reveals its systems, tapping a system opens its element page', async ({ page }) => {
  const env = loadEnv();

  const email = `landscape-mobile-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-mobile fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-mobile fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-mobile-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Mobile Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-mobile-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Mobile Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const systemAId = randomUUID();
  const systemBId = randomUUID();
  const actorId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemAId, elementType: 'system', name: 'Invoicing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemBId, elementType: 'system', name: 'Payments Service', parentId: null, attributes: { lifecycleStatus: 'retiring', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Finance Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemAId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemBId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: systemAId, toElementId: systemBId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    // An actor that only owns things is hidden behind "Show owners"; one that uses a system stays in the actor row.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: actorId, toElementId: systemAId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a capability with two systems, an actor, and a uses edge', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-mobile fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);

  // The canvas never mounts at this width — the list does instead.
  await expect(page.locator('canvas')).toHaveCount(0);

  const actorsGroup = page.getByRole('button', { name: /Actors/ });
  const capabilityGroup = page.getByRole('button', { name: /Billing Capability/ });
  await expect(actorsGroup).toBeVisible();
  await expect(capabilityGroup).toBeVisible();
  // Actors first, per item 13's own ordering.
  const groupHeaders = page.getByRole('button', { name: /Actors|Billing Capability/ });
  await expect(groupHeaders.first()).toHaveAccessibleName(/Actors/);
  expect(await hasHorizontalScroll(page)).toBe(false);

  // Collapsed: no system/actor rows visible yet.
  await expect(page.getByRole('link', { name: 'Invoicing Service' })).not.toBeVisible();

  // Expand the capability group.
  await capabilityGroup.click();
  await expect(capabilityGroup).toHaveAttribute('aria-expanded', 'true');
  const invoicingRow = page.getByRole('link', { name: 'Invoicing Service' });
  await expect(invoicingRow).toBeVisible();
  await expect(page.getByText('uses 1 · used by 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Context →' }).first()).toBeVisible();

  // Tapping the system row opens its element page.
  await invoicingRow.click();
  await expect(page).toHaveURL(new RegExp(`/e/${systemAId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Invoicing Service' })).toBeVisible();

  // Back on the landscape, expanding the Actors group reveals the team row.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await page.getByRole('button', { name: /Actors/ }).click();
  const financeRow = page.getByRole('link', { name: 'Finance Team' });
  await expect(financeRow).toBeVisible();
  await financeRow.click();
  await expect(page).toHaveURL(new RegExp(`/e/${actorId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Finance Team' })).toBeVisible();
});
