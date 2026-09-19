/**
 * Sprint U4-1 C6: "an owner-only 'Export as starter map' action: walks
 * the capability tree at main head, writes content/capability-maps/
 * <sector>/<version>.json (names, definitions, order, parent structure;
 * model-specific attributes dropped) [...]. Draft maps are seedable into
 * a model for review (owner-only, flagged draft)."
 *
 * The UI action writes straight into `capability_maps` (a running app has
 * no filesystem for the CLI's own content-file half — see
 * scripts/exportCapabilityMap.ts's own module comment), so this exercises
 * the full round trip: export a model's own tree as a draft starter map,
 * then seed a second, empty model from that exact draft and confirm its
 * content actually arrived, flagged "Draft" the whole time in the picker.
 *
 * Same "needs a real Supabase" limitation as e2e/capability-map.spec.ts.
 * The (sector, version) pair is global, unversioned-per-test-run content
 * (capability_maps has no org_id) — a version derived from the current
 * time keeps this test's own export from ever colliding with real seeded
 * content (which only ever uses small version numbers) or another run's.
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

test('capability map export: "Export as starter map" writes a draft, flagged as such, seedable into a different model', async ({ page }) => {
  const env = loadEnv();
  const version = Math.floor(Date.now() / 1000);

  const email = `capmap-export-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-export fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-export fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-export-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Export Test Org', slug: orgSlug, createdBy: userId });

  // Model A: has a real, tailored capability tree to export.
  const sourceModelId = randomUUID();
  const sourceModelSlug = `capmap-export-source-${sourceModelId.slice(0, 8)}`;
  await createModel(signedIn, { id: sourceModelId, orgId, name: 'Export Source Model', slug: sourceModelSlug, createdBy: userId });
  const sourceMain = await getMainBranch(signedIn, sourceModelId);
  if (!sourceMain) throw new Error('source model main branch was not auto-created');

  const { error: sourceRowError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: sourceModelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceRowError) throw new Error(`seed source: ${sourceRowError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', sourceModelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const childId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Grid Operations', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: childId, elementType: 'capability', name: 'Outage Management', parentId: rootId, attributes: { order: 10, description: 'Detecting, responding to and restoring supply after an outage.' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: sourceMain.id,
    parentCommitId: sourceMain.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a small tree to export',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId: sourceModelId, branchId: sourceMain.id, expectedHeadCommitId: sourceMain.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-export source fixture: ${seedResult.message}`);

  // --- Export it as a draft starter map ---
  await page.goto(`/o/${orgSlug}/m/${sourceModelSlug}/capability-map`);
  await expect(page.getByText('Grid Operations')).toBeVisible();

  // Sprint U4-2a check B5: "Export as starter map" now sits behind the
  // "⋯" overflow menu beside "+ Add capability", not as a button of its
  // own — open it first.
  await page.getByRole('button', { name: 'Capability map actions' }).click();
  await page.getByRole('button', { name: 'Export as starter map' }).click();
  await page.getByLabel('Sector').selectOption('electricity_network');
  await page.getByLabel('Version').fill(String(version));
  await page.getByRole('button', { name: 'Export' }).click();

  await expect(page.getByText(new RegExp(`Exported 2 item\\(s\\) as electricity_network v${String(version)} \\(draft\\)`))).toBeVisible();

  // --- A second, empty model can seed from that draft ---
  const targetModelId = randomUUID();
  const targetModelSlug = `capmap-export-target-${targetModelId.slice(0, 8)}`;
  await createModel(signedIn, { id: targetModelId, orgId, name: 'Export Target Model', slug: targetModelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${targetModelSlug}/capability-map`);
  await expect(page.getByText('This model has no capabilities yet.')).toBeVisible();

  const draftRow = page.getByRole('listitem').filter({ hasText: `electricity_network v${String(version)}` });
  await expect(draftRow).toBeVisible();
  await expect(draftRow.getByText('Draft')).toBeVisible();
  await draftRow.getByRole('button', { name: 'Import' }).click();

  // The exported content actually arrived — both levels, name and
  // description carried over. "Grid Operations" is the domain's own
  // collapsed summary row; "Outage Management" is its L2 child, hidden
  // until expanded (capability map redesign — collapsed by default).
  await expect(page.getByText('Grid Operations')).toBeVisible();
  await page.getByRole('button', { name: /Grid Operations/ }).click();
  await expect(page.getByText('Outage Management', { exact: true })).toBeVisible();
});
