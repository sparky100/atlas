/**
 * Sprint U4-2b item 10: "Page header on canvas routes follows the canvas's
 * full-width rule; actions never clip." The full-width rule itself
 * (`LandscapePage.tsx`'s `hasCanvas`/`.mainWithCanvas`) predates this item —
 * `CapabilityMapPage.tsx`'s own "Check D1" comment names Landscape as the
 * pattern it copied. What this item actually found and fixed is a real,
 * previously-untested clip risk: the header's own title is unbounded (a
 * capability filter interpolates that capability's real name straight into
 * the `<h1>`, `LandscapePage.tsx`'s own `capability ? ... : ''`), and
 * without `flex-wrap` that title and "+ Add system"/"+ Add actor" (visible,
 * unlike the narrow-viewport disclosure, at every width from 768px up)
 * would fight over one un-wrapping row.
 *
 * Real content, not a made-up string — the same longest starter-map level-1
 * capability name `capability-map-text-overflow.spec.ts` already uses.
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

const LONGEST_L1_NAME = 'Regulatory Compliance & Price-Control Reporting'; // Same real starter-map name capability-map-text-overflow.spec.ts uses.

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test('landscape header: a long capability-filter title never clips or pushes the header actions off-screen, at 768px and 900px', async ({ page }) => {
  const env = loadEnv();

  const email = `landscape-header-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-header fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-header fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-header-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Header Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-header-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Header Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capabilityId = randomUUID();
  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: LONGEST_L1_NAME, parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed a long capability name and a supporting system', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-header fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?ref=main&capability=${capabilityId}`);
  await expect(page.getByRole('heading', { name: `Systems supporting ${LONGEST_L1_NAME} (1)` })).toBeVisible();

  for (const width of [768, 900]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await hasHorizontalScroll(page)).toBe(false);
    // The actions row this width shows (>= 768px: inline, per LandscapePage.tsx's
    // own module comment) stays fully visible and clickable — not clipped
    // off-screen by the long title sharing its row.
    // The capability-scoped view's own header actions are its two exports;
    // the rightmost one is the first a long title would push off-screen.
    const lastAction = page.getByRole('button', { name: 'Export XLSX' });
    await expect(lastAction).toBeVisible();
    await expect(lastAction).toBeInViewport();
  }
});
