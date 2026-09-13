/**
 * Sprint U4-2b's own combined Playwright line: "ten systems across five
 * lanes with no tile/label intersection and no edge across a
 * non-endpoint tile."
 *
 * The geometry itself — no tile overlaps another tile or a label, no
 * routed edge crosses a non-endpoint tile — is proven against the exact
 * same pure, deterministic functions the app calls
 * (`src/ui/landscape/routing.test.ts`'s "ten systems across five lanes"
 * case, and `layout.test.ts`'s item 8 cases): Canvas 2D gives a browser
 * test no DOM to inspect that geometry through, the same limitation every
 * other landscape e2e spec's own module comment already names. What a
 * real browser run adds on top, and what this spec actually checks: the
 * scenario loads and renders for real, with ten systems and five lanes
 * (the aria-label's own accessible summary), edges drawn between systems
 * in different lanes (exercising the item-9 routing path for real, not
 * just in the pure function), and no page-level horizontal scroll at a
 * reasonably narrow desktop width.
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

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('landscape: ten systems across five lanes, with cross-lane edges, render with no page-level horizontal scroll', async ({ page }) => {
  const env = loadEnv();

  const email = `landscape-10x5-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-10x5 fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-10x5 fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-10x5-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Ten-by-Five Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-10x5-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Ten-by-Five Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const laneCount = 5;
  const systemCount = 10;
  const capabilityIds = Array.from({ length: laneCount }, () => randomUUID());
  const systemIds = Array.from({ length: systemCount }, () => randomUUID());

  const deltas: CommitEnvelope['deltas'] = capabilityIds.map((id, i) => ({
    kind: 'element.create',
    id: randomUUID(),
    elementId: id,
    elementType: 'capability',
    name: `Capability ${String(i)}`,
    parentId: null,
    attributes: {},
    sourceId: seedSourceId,
    confidence: 1,
  }));
  systemIds.forEach((id, i) => {
    deltas.push({ kind: 'element.create', id: randomUUID(), elementId: id, elementType: 'system', name: `System ${String(i).padStart(2, '0')}`, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 });
    const capabilityId = capabilityIds[i % laneCount];
    if (capabilityId) deltas.push({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: id, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 });
  });
  // A handful of cross-lane `uses` edges — the ones item 9's routing
  // actually has to work for, connecting systems placed in different lanes
  // (and, for the first pair, the same lane) rather than only adjacent
  // same-lane tiles a straight line would already clear.
  for (let i = 0; i < systemCount - 1; i += 2) {
    const from = systemIds[i];
    const to = systemIds[i + 3 < systemCount ? i + 3 : (i + 1) % systemCount];
    if (from && to) deltas.push({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: from, toElementId: to, attributes: {}, sourceId: seedSourceId, confidence: 1 });
  }

  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed ten systems across five lanes with cross-lane edges', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-10x5 fixture: ${seedResult.message}`);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', new RegExp(`${String(systemCount)} systems across ${String(laneCount)} lanes`), { timeout: 30_000 });

  expect(await hasHorizontalScroll(page)).toBe(false);
});
