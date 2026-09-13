/**
 * Prompt 7k item 5 / the shared changes-discussion item: the prompt pack's
 * own named Playwright scenario: "retire a system with a replacement and
 * see exposure clear."
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
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

test('retiring a system with a replacement transfers its supports edges and clears the capability\'s lifecycle exposure', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'retire', 'Legacy Billing System');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capabilityId = randomUUID();
  const replacementId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: replacementId, elementType: 'system', name: 'New Billing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed the capability, replacement and supports edge', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed capability/replacement/supports: ${seedResult.message}`);

  // 1. Baseline: set a near plannedEnd via the ordinary Edit form (no
  // Retire yet) and confirm the capability map's own "Lifecycle exposure"
  // colour-by shows it exposed — the state this test's own final assertion
  // must show has genuinely cleared, not merely "never appeared".
  const nearPlannedEnd = isoDateDaysFromNow(60);
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Legacy Billing System' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Planned end').fill(nearPlannedEnd);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Billing', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toBeVisible();

  // 2. Retire the system with a replacement.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Retire…' }).click();
  await page.getByLabel('Planned end').fill(nearPlannedEnd);
  await page.getByRole('button', { name: '+ Replaced by…' }).click();
  await page.getByPlaceholder('Search systems…').fill('New Billing Platform');
  await page.getByRole('button', { name: /New Billing Platform/ }).click();
  await expect(page.getByText('Replaced by', { exact: false })).toBeVisible();
  // `exact: true` — a plain substring match would also catch the header
  // menu's own "Retire…" item.
  await page.getByRole('button', { name: 'Retire', exact: true }).click();
  // The RetireAction panel closes on success and the header's own
  // lifecycle Chip now reads "retiring" — distinct from the submitting
  // button's own "Retiring…" label, which is gone by this point.
  await expect(page.getByText('retiring', { exact: true })).toBeVisible({ timeout: 15_000 });

  // 3. The replacement now supports Billing (a real relationship link, not
  // just its own name happening to contain the word); the capability's own
  // exposure has cleared — the replacement has no plannedEnd of its own.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${replacementId}?ref=main`);
  await expect(page.getByRole('link', { name: 'Billing', exact: true })).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Billing', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toHaveCount(0);
});
