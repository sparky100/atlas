/**
 * "Platforms and modules": `kind` gains `'platform'` (Salesforce, SAP,
 * Dynamics); a platform's `Container` children are its modules, each of
 * which `supports` a capability directly. The named Playwright scenario,
 * verbatim: "SAP as platform with FI and PM modules supporting Finance and
 * Asset Management appears in both lanes as module tiles and once in the
 * platform band; retire PM with a replacement and see Asset Management's
 * exposure clear."
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 * The desktop canvas's own tile drawing is pixels Playwright can't inspect
 * — verified via the narrow-viewport mobile list instead, a real DOM
 * group, same limitation `e2e/integration-platforms.spec.ts`'s own module
 * comment notes for the platform band.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('a platform\'s modules get their own capability-lane tiles, the platform lands once in the platform band, and retiring a module with a replacement clears its capability\'s exposure', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'platmod', 'SAP');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: sapId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const fiId = randomUUID();
  const pmId = randomUUID();
  const pmReplacementId = randomUUID();
  const financeId = randomUUID();
  const assetManagementId = randomUUID();
  const nearPlannedEnd = isoDateDaysFromNow(60);

  const deltas: Delta[] = [
    // SAP is the fixture's own seeded system — mark it a platform.
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: fiId, elementType: 'container', name: 'FI', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    // PM carries its own near plannedEnd — the baseline exposure this test's own first assertion checks for.
    { kind: 'element.create', id: randomUUID(), elementId: pmId, elementType: 'container', name: 'PM', parentId: sapId, attributes: { isExternal: false, plannedEnd: nearPlannedEnd }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: pmReplacementId, elementType: 'container', name: 'PM Replacement', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: financeId, elementType: 'capability', name: 'Finance', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: assetManagementId, elementType: 'capability', name: 'Asset Management', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: fiId, toElementId: financeId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: pmId, toElementId: assetManagementId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed SAP as a platform with FI/PM modules and two capabilities', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed platform/modules/capabilities: ${seedResult.message}`);

  // 1. Baseline: Asset Management reads exposed (PM's own near plannedEnd) —
  // the capability map's own "Lifecycle exposure" colour-by, confirming
  // module-level supports edges are already counted for capability-map
  // metrics before this test ever retires anything.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Asset Management', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toBeVisible();

  // 2. Narrow-viewport landscape: both modules get their own tile in their
  // own capability's lane, labelled "SAP · FI"/"SAP · PM"; SAP itself
  // appears exactly once, under "Platforms" — never as a module tile.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);

  const financeGroup = page.getByRole('button', { name: /^Finance\b/ });
  await expect(financeGroup).toBeVisible();
  await financeGroup.click();
  await expect(page.getByText('SAP · FI', { exact: true })).toBeVisible();

  const assetManagementGroup = page.getByRole('button', { name: /^Asset Management\b/ });
  await expect(assetManagementGroup).toBeVisible();
  await assetManagementGroup.click();
  await expect(page.getByText('SAP · PM', { exact: true })).toBeVisible();

  const platformsGroup = page.getByRole('button', { name: /^Platforms\b/ });
  await expect(platformsGroup).toBeVisible();
  await platformsGroup.click();
  // The list opens one group at a time, so Platforms is now the only one
  // open: SAP is listed there, once, and neither module is (they live in
  // their capabilities' groups, checked above).
  const platformsList = page.getByRole('list').filter({ has: page.getByRole('link', { name: /SAP/ }) });
  await expect(platformsList.getByText('SAP', { exact: true })).toHaveCount(1);
  await expect(platformsList.getByText(/SAP · /)).toHaveCount(0);

  // 3. Retire PM with a replacement module.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${pmId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'PM' })).toBeVisible();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Retire…' }).click();
  await page.getByLabel('Planned end').fill(nearPlannedEnd);
  await page.getByRole('button', { name: '+ Replaced by…' }).click();
  await page.getByPlaceholder('Search modules…').fill('PM Replacement');
  await page.getByRole('button', { name: /PM Replacement/ }).click();
  await expect(page.getByText('Replaced by', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Retire', exact: true }).click();
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 4. Asset Management's own exposure has cleared — the replacement
  // module has no plannedEnd of its own.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Asset Management', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toHaveCount(0);
});
