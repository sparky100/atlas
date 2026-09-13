/**
 * Prompt 7k item 5: regulatory alignment. The prompt pack's own named
 * Playwright scenario: "mark a capability essential and see a supporting
 * system without a technical owner listed under Assurance."
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

test('marking a capability essential surfaces a supporting system with no technical owner under Assurance, and clears once one is added', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'essential', 'Meter Reading Service');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capabilityId = randomUUID();
  const actorId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Water Supply', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Ops Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed the capability, actor and supports edge', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed capability/actor/supports: ${seedResult.message}`);

  // 1. Mark the capability essential.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${capabilityId}`);
  await expect(page.getByRole('heading', { name: 'Water Supply' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Essential function (NIS/CAF)').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  // 2. The architect door's own Assurance panel names the unowned
  // supporting system — derived down from the capability through supports,
  // never stored on the system itself.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Assurance' })).toBeVisible();
  await expect(page.getByText('1 system supporting an essential function with no technical owner')).toBeVisible();
  await expect(page.getByText('Meter Reading Service', { exact: true })).toBeVisible();

  // 3. Adding a technical owner clears it.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await page.getByRole('button', { name: '+ Add owned by' }).click();
  await page.getByPlaceholder('Search…').fill('Ops Team');
  await page.getByRole('button', { name: 'Ops Team', exact: false }).click();
  await expect(page.getByText('What role does Ops Team have for Meter Reading Service?')).toBeVisible();
  await page.getByRole('button', { name: 'Technical' }).click();
  await expect(page.getByText('technical owner', { exact: false })).toBeVisible({ timeout: 15_000 });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Assurance' })).toBeVisible();
  await expect(page.getByText(/supporting an essential function with no technical owner/)).toHaveCount(0);
});
