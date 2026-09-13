/**
 * Prompt 7k item 4: integration platforms. The prompt pack's own combined
 * Playwright line: "A flows_to B via M, listed on M's page, toggle routes
 * the edge." Also covers the third staged prompt in `RelationshipAdd.tsx`
 * (target → label → via) and the landscape's platform band (verified via
 * the narrow-viewport mobile list, a real DOM group — the desktop canvas's
 * own zone rectangle and edge routing are pixels Playwright can't inspect,
 * same limitation `e2e/it-ot-domain.spec.ts`'s own module comment notes
 * for the OT zone).
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('A flows_to B via M: the third staged prompt records via, M\'s page lists the flow, and the platform gets its own landscape zone', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system is A ("Meter Reading Service").
  const fixture = await bootstrapChangeBranchFixture(page, env, 'platforms', 'Meter Reading Service');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: meterReadingId, userId: ownerId } = fixture;

  const main = await getMainBranch(owner, modelId);
  if (!main) throw new Error('main branch missing');
  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const billingPlatformId = randomUUID();
  const esbId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: billingPlatformId, elementType: 'system', name: 'Billing Platform', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: esbId, elementType: 'system', name: 'Enterprise Service Bus', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'integration_platform' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed B and the platform M', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed B and M: ${seedResult.message}`);

  // 1. A flows_to B, via M — target, then label, then the new via stage.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${meterReadingId}`);
  await expect(page.getByRole('heading', { name: 'Meter Reading Service' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add flows to' }).click();
  await page.getByPlaceholder('Search…').fill('Billing Platform');
  await page.getByRole('button', { name: /Billing Platform/ }).click();
  await page.getByPlaceholder('e.g. reads customer records from').fill('sends interval reads to');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Does this go via an integration platform?')).toBeVisible();
  await page.getByPlaceholder('Search platforms…').fill('Enterprise Service Bus');
  await page.getByRole('button', { name: /Enterprise Service Bus/ }).click();
  await expect(page.getByRole('link', { name: /Billing Platform/ })).toBeVisible({ timeout: 15_000 });

  // 2. M's own page lists the flow under "Flows via this platform".
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${esbId}`);
  await expect(page.getByRole('heading', { name: 'Enterprise Service Bus' })).toBeVisible();
  await expect(page.getByText('Flows via this platform', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Meter Reading Service' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Billing Platform' })).toBeVisible();

  // 3. The landscape's platform band — narrow viewport forces the mobile
  // list (a real DOM group, unlike the desktop canvas's own pixel-drawn
  // band), which groups M under its own "Platforms" heading.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const platformsGroup = page.getByRole('button', { name: /^Platforms\b/ });
  await expect(platformsGroup).toBeVisible();
  await platformsGroup.click();
  await expect(page.getByText('Enterprise Service Bus')).toBeVisible();

  // 4. The "route via platforms" toggle exists and is wired to real state
  // — desktop only, so switch back to a normal viewport first.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const routeViaToggle = page.getByRole('checkbox', { name: 'Route via platforms' });
  await expect(routeViaToggle).toBeVisible();
  await expect(routeViaToggle).not.toBeChecked();
  await routeViaToggle.check();
  await expect(routeViaToggle).toBeChecked();
});
