/**
 * Check D1 (docs/CHECK-U4-2a.md): "Canvas routes (landscape, capability
 * map, context, container) escape page max-width, fill the viewport from
 * the nav rail to the right edge... Fit computes against that box."
 * Landscape already did this (Sprint U4-2a item 5); found "Partial" for
 * the other three — `CapabilityMapPage.module.css`/`ViewPage.module.css`'s
 * own `.main` stayed a fixed `max-width: 1400px` regardless of viewport
 * width. This spec is the missing coverage for those three, at a viewport
 * wide enough (1800px) that a fixed 1400px cap would leave a very visible
 * gap on the right if the escape weren't real. This originally covered a
 * fourth route, Component, one level deeper than Container — S1 item 18
 * removed the component level from the taxonomy entirely, so Container is
 * now the zoom chain's last stop.
 *
 * "Fit computes against that box" only ever applied to Landscape (a real
 * zoom/pan canvas) — the other three are plain reflowing DOM (this file's
 * own routes' module comments), so this only checks the width escape
 * itself, not a Fit computation none of them has.
 *
 * Same "needs a real Supabase" limitation as every Playwright test in
 * this repo — seeds a capability, and a System → Container chain (the
 * same shape e2e/zoom-chain-structure.spec.ts's own fixture uses) via the
 * real commitToBranch path from Node, then drives navigation through the
 * actual browser.
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

const VIEWPORT_WIDTH = 1800;
// A fixed 1400px `.main` (padding included) would leave `main`'s own
// rendered width well under this — comfortably past both the old cap and
// ordinary sub-pixel/scrollbar rounding.
const ESCAPED_WIDTH_FLOOR = 1500;

async function mainWidth(page: Page): Promise<number> {
  return page.locator('main').evaluate((el) => el.getBoundingClientRect().width);
}

test('capability map, context and container all escape the page\'s usual centred max-width once they have real content', async ({ page }) => {
  const env = loadEnv();

  const email = `viewpage-width-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`view-page-full-width fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`view-page-full-width fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `viewpage-width-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'View Page Width Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `viewpage-width-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'View Page Width Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const systemId = randomUUID();
  const containerId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: containerId, elementType: 'container', name: 'API Gateway', parentId: systemId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability, and a system with a container',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding view-page-full-width fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 900 });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Billing', { exact: true })).toBeVisible();
  expect(await mainWidth(page)).toBeGreaterThan(ESCAPED_WIDTH_FLOOR);

  // Each route's own heading renders as soon as the *page* (org/model)
  // resolves, before the route's own content fetch (`useSystemContext`/
  // `useStructureView`) necessarily reaches `'ready'` — `.mainWithView`
  // only applies once it does, so each check waits for a piece of real
  // *content* (the hub/child element's own name), not just the heading,
  // the same distinction e2e/zoom-chain-structure.spec.ts's own
  // assertions already draw.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}`);
  await expect(page.getByText('Billing Service').first()).toBeVisible();
  expect(await mainWidth(page)).toBeGreaterThan(ESCAPED_WIDTH_FLOOR);

  await page.getByRole('link', { name: 'Containers →' }).click();
  await expect(page.getByText('API Gateway')).toBeVisible();
  expect(await mainWidth(page)).toBeGreaterThan(ESCAPED_WIDTH_FLOOR);
});

test('capability map stays at the ordinary centred max-width while it has nothing to show yet (empty, import panel visible)', async ({ page }) => {
  const env = loadEnv();

  const email = `viewpage-width-empty-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`view-page-full-width empty fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`view-page-full-width empty fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `viewpage-width-empty-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'View Page Width Empty Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `viewpage-width-empty-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'View Page Width Empty Test Model', slug: modelSlug, createdBy: userId });

  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 900 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();
  expect(await mainWidth(page)).toBeLessThan(ESCAPED_WIDTH_FLOOR);
});
