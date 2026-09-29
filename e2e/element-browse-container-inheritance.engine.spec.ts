/**
 * User-reported gap: the browse table/cards showed nothing at all for a
 * platform's own modules (containers) — not even a module's own directly-
 * set lifecycle/criticality, let alone the platform's value when the
 * module leaves them unset. `ElementBrowseTable.tsx`/`ElementBrowseCards.tsx`
 * never changed — this is purely `db/elementBrowse.ts`'s `lifecycleStatusOf`/
 * `criticalityOf` now resolving a container's *effective* value (own
 * override if set, else its parent platform's), the same convention
 * `moduleAttributes.ts`'s `effectiveModuleAttributes` already establishes
 * for capability-map coverage/exposure and the roadmap.
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

test('a module with no lifecycle/criticality override reads its platform\'s effective value on the browse table; a module with its own override keeps it', async ({ page }) => {
  const env = loadEnv();

  const email = `container-inherit-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`container-inherit fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`container-inherit fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `container-inherit-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Container Inherit Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `container-inherit-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Container Inherit Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const platformId = randomUUID();
  const moduleNoOverrideId = randomUUID();
  const moduleOverrideId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: platformId, elementType: 'system', name: 'ArcGIS', parentId: null, attributes: { lifecycleStatus: 'active', criticality: 'high', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: moduleNoOverrideId, elementType: 'container', name: 'Enterprise', parentId: platformId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: moduleOverrideId, elementType: 'container', name: 'Pro', parentId: platformId, attributes: { isExternal: false, lifecycleStatus: 'retiring', criticality: 'low' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a platform and two of its own modules', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding container-inherit fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements`);

  function rowOf(name: string) {
    return page.locator('table').nth(1).locator('tbody tr').filter({ hasText: name });
  }

  // Enterprise has no override — reads ArcGIS's own values.
  await expect(rowOf('Enterprise').locator('td').nth(3)).toHaveText('active');
  await expect(rowOf('Enterprise').locator('td').nth(4)).toHaveText('high');

  // Pro has its own override — keeps it, not the platform's.
  await expect(rowOf('Pro').locator('td').nth(3)).toHaveText('retiring');
  await expect(rowOf('Pro').locator('td').nth(4)).toHaveText('low');

  // The platform itself is unaffected either way.
  await expect(rowOf('ArcGIS').locator('td').nth(3)).toHaveText('active');
  await expect(rowOf('ArcGIS').locator('td').nth(4)).toHaveText('high');

  // Same story on the mobile card view — this is purely a data-layer fix,
  // so both renderers pick it up for free.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  const enterpriseCard = page.getByRole('listitem').filter({ hasText: 'Enterprise' });
  await expect(enterpriseCard.getByText('active', { exact: true })).toBeVisible();
  await expect(enterpriseCard.getByText('high', { exact: true })).toBeVisible();
  const proCard = page.getByRole('listitem').filter({ hasText: 'Pro' });
  await expect(proCard.getByText('retiring', { exact: true })).toBeVisible();
  await expect(proCard.getByText('low', { exact: true })).toBeVisible();
});
