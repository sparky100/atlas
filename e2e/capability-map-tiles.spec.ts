/**
 * Sprint U4-1 C3: "Blueprint-framed tile component [...]; plain-text
 * name; whole tile is the click target; no underlined links; colour-by
 * tone fills the tile with an accessible label." Exercises the shared
 * `CapabilityTile` component (`src/ui/components/CapabilityTile/`) as
 * used by the capability map's L2 cards, plus the review follow-up's L1
 * group-header aggregate (`aggregateTileColourFor`, `metrics.ts`).
 *
 * Same "needs a real Supabase" limitation as e2e/capability-map.spec.ts.
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

test('capability map tiles: no underlined link, whole tile is the click target, secondary controls stay independently clickable', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-tiles-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-tiles fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-tiles fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-tiles-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Tiles Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-tiles-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Tiles Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const housingId = randomUUID();
  const systemId = randomUUID();

  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Digital Services', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: housingId, elementType: 'capability', name: 'Housing', parentId: rootId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Housing Portal', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: housingId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one L2 capability with a supporting system',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-tiles fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Housing', { exact: true })).toBeVisible();

  // Colour-by on: the tile's own tone fill needs a real mode selected to
  // have anything to check.
  await page.getByLabel('Colour by').selectOption({ label: 'Coverage (supporting-system count)' });
  await expect(page.getByText('1 supporting system')).toBeVisible();

  // "Plain-text name" / "no underlined links": the primary link is the
  // capability's own name.
  const primaryLink = page.getByRole('link', { name: 'Housing', exact: true });
  await expect(primaryLink).toHaveCSS('text-decoration-line', 'none');

  // "Whole tile is the click target": clicking the tone chip's own text —
  // not the name link itself, and not a real control — still navigates
  // to the capability's element page. This is CapabilityTile's "stretched
  // link" overlay (that component's own module comment): the chip isn't
  // a link, so a real click here only reaches the element page because
  // the tile's own primary-link overlay is what the browser's hit-test
  // actually resolves to at that point — `force: true` because that's
  // exactly the thing Playwright's own actionability check would
  // otherwise refuse to click through (correctly, for an accidental
  // overlap; deliberately, here).
  await page.getByText('1 supporting system').click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/e/${housingId}$`));

  // Secondary controls stay independently clickable, not swallowed by
  // that same overlay: the zoom link goes to the landscape, not the
  // element page.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByRole('link', { name: '1 system →' }).click();
  await expect(page).toHaveURL(/\/landscape\?/);
});

test('capability map tiles: an L1 whose only exposed capability sits at L3 still shows the exposed tone at L1', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-l1-agg-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-l1-agg fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-l1-agg fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-l1-agg-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map L1 Aggregate Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-l1-agg-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map L1 Aggregate Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const housingId = randomUUID();
  const repairsId = randomUUID(); // L3, under Housing
  const systemId = randomUUID();

  // Housing (L2) itself has no supporting system at all — only its L3
  // child, Repairs, does, and that one system is exposed (plannedEnd
  // within the horizon, lifecycleExposure's own STALE_AFTER_MONTHS).
  const soon = new Date();
  soon.setMonth(soon.getMonth() + 1);

  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Digital Services', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: housingId, elementType: 'capability', name: 'Housing', parentId: rootId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: repairsId, elementType: 'capability', name: 'Repairs', parentId: housingId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    {
      kind: 'element.create',
      id: randomUUID(),
      elementId: systemId,
      elementType: 'system',
      name: 'Legacy Repairs System',
      parentId: null,
      attributes: { lifecycleStatus: 'retiring', isExternal: false, plannedEnd: soon.toISOString().slice(0, 10) },
      sourceId: seedSourceId,
      confidence: 1,
    },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: repairsId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed an L1/L2/L3 tree where only the L3 capability is exposed',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-l1-agg fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Digital Services')).toBeVisible();

  await page.getByLabel('Colour by').selectOption({ label: 'Lifecycle exposure' });

  // The L1 header shows "exposed" without the L2 card ever being
  // expanded to reveal the L3 that's actually the source of it — the
  // aggregate is computed over the already-loaded tree, not derived from
  // what's currently visible on screen.
  await expect(page.getByText('Repairs')).toHaveCount(0);
  await expect(page.getByText('exposed')).toBeVisible();

  // No underline on the L1 header's own name link (the review note's
  // other ask).
  await expect(page.getByRole('link', { name: 'Digital Services' })).toHaveCSS('text-decoration-line', 'none');
});
