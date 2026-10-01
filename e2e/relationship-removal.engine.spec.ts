/**
 * "Relationship removal": the prompt's own golden path, verbatim — "from an
 * element page, remove a uses relationship and confirm it is gone from the
 * context view and present in history; remove a primary supports and
 * confirm the lane change."
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

test('removing a uses relationship clears it from Relationships/Context and keeps it in History; removing a system\'s only primary supports edge moves it to the Unassigned lane', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'relrem', 'System A');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capabilityId = randomUUID();
  const systemBId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Ops', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: systemBId, elementType: 'system', name: 'System B', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    // System A's only supports edge — its own primary, so removing it has
    // nowhere else to fall back to (`placementFor`'s zero-edges case).
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: systemId, toElementId: systemBId, attributes: { description: 'reads records from' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed the capability, System B, supports and uses edges', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed capability/System B/edges: ${seedResult.message}`);

  // 1. Remove the `uses` relationship from System A's own page.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'System A' })).toBeVisible();

  // One relationship's own row: the innermost element holding both its link and its actions menu.
  const usesRow = page.locator('div').filter({ has: page.getByRole('link', { name: /System B/ }) }).filter({ has: page.getByRole('button', { name: 'Relationship actions' }) }).last();
  await usesRow.getByRole('button', { name: 'Relationship actions' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('System A will no longer use System B.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('link', { name: 'System B' })).toHaveCount(0);

  // 2. Gone from the Context view.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}?ref=main`);
  await expect(page.getByText('System B')).toHaveCount(0);

  // 3. Present in History, both the creation and the retraction.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByText('created — uses System B')).toBeVisible();
  await expect(page.getByText('retracted — uses System B')).toBeVisible();

  // 4. Remove the primary `supports` edge — System A's only one, so no
  // "make <other> primary" candidates render, just the plain confirm.
  const supportsRow = page.locator('div').filter({ has: page.getByRole('link', { name: /Ops/ }) }).filter({ has: page.getByRole('button', { name: 'Relationship actions' }) }).last();
  await supportsRow.getByRole('button', { name: 'Relationship actions' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('System A will no longer support Ops.')).toBeVisible();
  await expect(page.getByText('will move to the Unassigned lane')).toBeVisible();
  await expect(page.getByRole('button', { name: /make .+ primary/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Ops' })).toHaveCount(0);

  // 5. Landscape: System A has moved from Ops's own lane into Unassigned.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);

  const unassignedGroup = page.getByRole('button', { name: /^Unassigned\b/ });
  await expect(unassignedGroup).toBeVisible();
  await unassignedGroup.click();
  await expect(page.getByText('System A', { exact: true })).toBeVisible();
});
