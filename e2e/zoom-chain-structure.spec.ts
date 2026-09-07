/**
 * Context, Container and Component's core user path (Sprint H1 item 9,
 * closing the audit's own "zero Playwright coverage" finding for all
 * three — docs/AUDIT-2026-09-U2.md §5.3): from one seeded System, descend
 * the zoom chain (UI-principles §2.1) System → Context → Containers →
 * Components, following the real "Containers →"/"Components →" links each
 * page renders, and see each level's own child at the bottom.
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts —
 * seeds its System/Container/Component via the real commitToBranch path
 * from Node, then drives navigation through the actual browser. No
 * genesis-commit bootstrap (ADR-018): main already has a real head the
 * instant createModel's insert fires.
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

test('descending the zoom chain: a system\'s context, its containers, and a container\'s components', async ({ page }) => {
  const env = loadEnv();

  const email = `zoomchain-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`zoom-chain fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`zoom-chain fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `zoomchain-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Zoom Chain Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `zoomchain-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Zoom Chain Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const containerId = randomUUID();
  const componentId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: containerId, elementType: 'container', name: 'API Gateway', parentId: systemId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: componentId, elementType: 'component', name: 'Auth Module', parentId: containerId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    message: 'seed Billing Service, its API Gateway container, and an Auth Module component',
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding the structure fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Zoom Chain Test Model')).toBeVisible();
  // .first(): the system name legitimately appears more than once on this
  // page (heading and breadcrumb) — this check only cares that it shows up.
  await expect(page.getByText('Billing Service').first()).toBeVisible();

  await page.getByRole('link', { name: 'Containers →' }).click();
  await expect(page).toHaveURL(new RegExp(`/container/${systemId}`));
  await expect(page.getByRole('heading', { name: 'Containers' })).toBeVisible();
  await expect(page.getByText('API Gateway')).toBeVisible();
  // The zoom chain's breadcrumb now names the system this container list
  // belongs to, not just the model — proof the page resolved the real
  // parent, not just the URL's raw id.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Billing Service')).toBeVisible();

  await page.getByRole('link', { name: 'Components →' }).click();
  await expect(page).toHaveURL(new RegExp(`/component/${containerId}`));
  await expect(page.getByRole('heading', { name: 'Components' })).toBeVisible();
  await expect(page.getByText('Auth Module')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('API Gateway')).toBeVisible();
});
