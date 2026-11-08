/**
 * ADR-001 amendment ("replaces"): a recorded `replaces` edge is what "has a
 * planned replacement" means. Seeds a critical system near its planned end
 * that keeps its own `supports` edge (no transfer, unlike "Retire…" with a
 * replacement — `retire-with-replacement.engine.spec.ts`) plus an active
 * replacement with no `plannedEnd`, so the only thing that can clear the
 * exposure is the `replaces` edge itself, then checks the capability map's
 * Lifecycle exposure colour-by, the critical-exposed finding and the new
 * "replacement with no departure plan" finding.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('a replaces edge clears exposure and an active replacement with no plannedEnd is flagged', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'replaces-exposure', 'Legacy Billing System');
  const { signedIn, orgSlug, modelId, modelSlug, systemId, seedSourceId, main, seedCommitId } = fixture;

  const capabilityId = randomUUID();
  const replacementId = randomUUID();
  const replacesRelationshipId = randomUUID();
  const common = { sourceId: seedSourceId, confidence: 1 };
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, ...common },
    { kind: 'element.create', id: randomUUID(), elementId: replacementId, elementType: 'system', name: 'New Billing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, ...common },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, ...common },
  ];
  const seed: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: seedCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed capability, replacement and supports', body: null, deltas };
  const seeded = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: seedCommitId, envelope: seed });
  if (!seeded.ok) throw new Error(`seed: ${seeded.message}`);

  // 1. Baseline, no `replaces` edge yet: make the legacy system critical with a near planned end.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Legacy Billing System' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Planned end').fill(isoDateDaysFromNow(60));
  await page.getByLabel('Criticality').selectOption('critical');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('exposed')).toBeVisible();
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements?filter=critical-exposed`);
  await expect(page.getByRole('link', { name: 'Legacy Billing System' })).toBeVisible();

  // 2. Record the replacement as a real fact, leaving Legacy's own supports edge in place.
  const head = await signedIn.from('branches').select('head_commit_id').eq('id', main.id).single();
  const headCommitId = (head.data as { head_commit_id: string }).head_commit_id;
  const replaces: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: headCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'record that New Billing Platform replaces Legacy Billing System',
    body: null,
    deltas: [{ kind: 'relationship.create', id: randomUUID(), relationshipId: replacesRelationshipId, relationshipType: 'replaces', fromElementId: replacementId, toElementId: systemId, attributes: {}, ...common }],
  };
  const recorded = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: headCommitId, envelope: replaces });
  if (!recorded.ok) throw new Error(`record replaces: ${recorded.message}`);

  // 3. Exposure has cleared on the map and in the finding, though Legacy still supports Billing.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await page.getByLabel('Colour by').selectOption('metric:lifecycleExposure');
  await expect(page.getByText('Billing', { exact: true })).toBeVisible();
  await expect(page.getByText('exposed')).toHaveCount(0);
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements?filter=critical-exposed`);
  await expect(page.getByRole('link', { name: 'Legacy Billing System' })).toHaveCount(0);

  // 4. The replacement is active with no planned end of its own — flagged on Home and in the Elements filter.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('1 replacement with no departure plan', { exact: true })).toBeVisible();
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/elements?filter=replacement-no-departure-plan`);
  await expect(page.getByRole('link', { name: 'New Billing Platform' })).toBeVisible();
});
