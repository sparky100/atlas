/**
 * Sprint U4-1 C2: "responsive grid of level-1 groups (5 columns >=1280,
 * 4 desktop, 2 tablet, 1 at 390px), whole map visible without horizontal
 * scroll". `CapabilityMapView.module.css`'s own comment names the exact
 * breakpoints this asserts against, and its `role="list"`/`role="listitem"`
 * addition (CapabilityMapView.tsx's own comment) is what lets this test
 * find the grid container without a CSS-module class selector — this
 * codebase's e2e specs never match by (possibly production-hashed) class
 * name.
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

/** The grid container's own `grid-template-columns`, split into its per-column tokens — its length is the actual rendered column count at whatever viewport the page is currently at. */
async function columnCount(page: Page): Promise<number> {
  const value = await page.getByRole('list', { name: 'Level 1 capabilities' }).evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return value.trim().split(/\s+/).filter(Boolean).length;
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('capability map layout: L1 column count matches the responsive grid tiers, with no horizontal scroll at any of them', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-layout-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-layout fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-layout fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-layout-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Layout Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-layout-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Layout Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Six L1 capabilities: more than any tier's own column count (5 at the
  // widest), so a real grid actually has to wrap a row rather than every
  // tier trivially fitting everything on one line regardless of whether
  // wrapping works.
  const names = ['Finance', 'Procurement', 'Human Resources', 'Customer Contact', 'Estates', 'Digital & Technology'];
  const deltas: Delta[] = names.map((name, index) => ({
    kind: 'element.create',
    id: randomUUID(),
    elementId: randomUUID(),
    elementType: 'capability',
    name,
    parentId: null,
    attributes: { order: (index + 1) * 10 },
    sourceId: seedSourceId,
    confidence: 1,
  }));

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed six ordered L1 capabilities',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-layout fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Finance')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(async () => { expect(await columnCount(page)).toBe(5); }).toPass();
  expect(await hasHorizontalScroll(page)).toBe(false);

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(async () => { expect(await columnCount(page)).toBe(4); }).toPass();
  expect(await hasHorizontalScroll(page)).toBe(false);

  await page.setViewportSize({ width: 800, height: 900 });
  await expect(async () => { expect(await columnCount(page)).toBe(2); }).toPass();
  expect(await hasHorizontalScroll(page)).toBe(false);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(async () => { expect(await columnCount(page)).toBe(1); }).toPass();
  expect(await hasHorizontalScroll(page)).toBe(false);

  // Every capability is still reachable at the narrowest tier — wrapped
  // onto further rows, not dropped or hidden behind a scrollbar.
  for (const name of names) {
    await expect(page.getByText(name)).toBeVisible();
  }
});
