/**
 * Capability map redesign (density pass): the old shared `CapabilityTile`
 * component (blueprint-framed, tone-filled, a whole-tile "stretched link"
 * so any secondary text still navigated) is gone — deleted along with
 * this view's own filled/chip treatment, since a filled amber tile reads
 * as a flagged problem, which this view's own role boundary forbids it
 * from being. Its replacement, a single compact row (`CapabilityRow`,
 * `CapabilityMapView.tsx`), has a real primary link on the name only —
 * no stretched-link overlay — so this file's own "whole tile is the
 * click target" coverage becomes its opposite: the name link navigates,
 * a plain-text indicator label does not, and the "→ Landscape" drill-
 * through (its own real link, unrelated to either) still does. The L1
 * aggregate-tone test below (an L1 whose only exposed descendant sits at
 * L3) is otherwise unaffected — `aggregateTileColourFor` itself never
 * changed, only how its tone/label are drawn.
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

test('capability map cards: the name link navigates, a plain-text tone indicator does not, the drill-through link still does', async ({ page }) => {
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
  await page.getByRole('button', { name: /Digital Services/ }).click();
  await expect(page.getByText('Housing', { exact: true })).toBeVisible();

  // Colour-by on: the row's own indicator needs a real mode selected to
  // have anything to check. Not Coverage: a bug-fix follow-up removed that
  // one mode's own indicator on cards entirely — its label only ever
  // restated the "→ Landscape" count's zero/non-zero state in words
  // ("supporting systems"/"no supporting systems"), never a value of its
  // own, so it had nothing left to click once fixed. Oldest lifecycle
  // stage's own label is the stage name itself, a real, distinct fact.
  await page.getByLabel('Colour by').selectOption({ label: 'Oldest lifecycle stage' });
  // The card's own indicator (the domain header shows its rolled-up stage too).
  await expect(page.getByRole('list', { name: 'Digital Services capabilities' }).getByText('active', { exact: true })).toBeVisible();

  // "Plain-text name, no underline": the primary link is the capability's
  // own name, and it's what actually navigates.
  const primaryLink = page.getByRole('link', { name: 'Housing', exact: true });
  await expect(primaryLink).toHaveCSS('text-decoration-line', 'none');
  await primaryLink.click();
  await expect(page).toHaveURL(new RegExp(`/e/${housingId}$`));

  // No more stretched-link overlay (the old `CapabilityTile`'s "whole
  // tile is the click target" — deleted with it): clicking the plain-text
  // tone indicator does nothing, since it's ordinary inline text now, not
  // a click target of any kind.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByRole('button', { name: /Digital Services/ }).click();
  await page.getByRole('list', { name: 'Digital Services capabilities' }).getByText('active', { exact: true }).click();
  await expect(page).toHaveURL(/\/capability-map/);
  await expect(page).not.toHaveURL(new RegExp(`/e/${housingId}$`));

  // The "→ Landscape" drill-through is its own real link, unaffected by
  // any of the above.
  await page.getByRole('list', { name: 'Digital Services capabilities' }).getByRole('link', { name: '1 system →' }).click();
  await expect(page).toHaveURL(/\/landscape\?/);
});

test('capability map: an L1 whose only exposed capability sits at L3 still shows the exposed tone at L1', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: /Digital Services/ })).toBeVisible();

  await page.getByLabel('Colour by').selectOption({ label: 'Lifecycle exposure' });

  // The domain header shows "exposed" without ever being expanded to
  // reveal the L2/L3 that's actually the source of it — the aggregate is
  // computed over the already-loaded tree, not derived from what's
  // currently visible on screen.
  await expect(page.getByText('Repairs')).toHaveCount(0);
  await expect(page.getByText('exposed')).toBeVisible();

  // No underline on the domain's own "Open →" link, once expanded (the
  // review note's other ask — the collapsed header itself has no link at
  // all any more, just plain text; the real navigable link only appears
  // in the expanded body).
  await page.getByRole('button', { name: /Digital Services/ }).click();
  await expect(page.getByRole('link', { name: /Open Digital Services/ })).toHaveCSS('text-decoration-line', 'none');
});
