/**
 * Prompt 7k item 3: IT/OT domain. The prompt pack's own combined
 * Playwright line: "two systems, one OT, a flow between them listed as a
 * crossing." Also covers the landscape's OT zone (via the narrow-viewport
 * mobile list, which renders lane groups as real DOM text — the desktop
 * canvas draws the same grouping, but only as pixels, `e2e/landscape-hollow-marker-and-filter.spec.ts`'s
 * own module comment makes the same point about canvas assertions) and
 * the "Boundary crossings" list page reachable from the architect door.
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

test('a flow between an IT and an OT system is listed as a boundary crossing, and the OT system is zoned separately on the landscape', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system defaults to domain 'it' — no attribute needed.
  const fixture = await bootstrapChangeBranchFixture(page, env, 'itotdomain', 'Billing Platform');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: billingPlatformId, userId: ownerId } = fixture;

  const main = await getMainBranch(owner, modelId);
  if (!main) throw new Error('main branch missing');
  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const plcControllerId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: plcControllerId, elementType: 'system', name: 'PLC Controller', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, domain: 'ot' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed an OT system', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed OT system: ${seedResult.message}`);

  // 1. A flows_to edge from the IT system to the OT one — the ordinary
  // verb-phrase-label flow (Sprint U4-1 B5), no domain-specific UI.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${billingPlatformId}`);
  await expect(page.getByRole('heading', { name: 'Billing Platform' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add flows to' }).click();
  await page.getByPlaceholder('Search…').fill('PLC Controller');
  await page.getByRole('button', { name: /PLC Controller/ }).click();
  await page.getByPlaceholder('e.g. reads customer records from').fill('sends setpoints to');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: /PLC Controller/ })).toBeVisible();

  // 2. "Boundary crossings" — reachable from the architect door, lists
  // this exact edge. The home page's own count-and-link block is checked
  // by presence/navigation only (its count is two adjacent `<Text>` spans
  // concatenated with no separator, not a single stable string to assert
  // on) — the list page below is the real content check.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Boundary crossings' })).toBeVisible();
  await page.getByRole('link', { name: 'View all →' }).click();
  await expect(page.getByRole('heading', { name: 'Boundary crossings' })).toBeVisible();
  await expect(page.getByText('Billing Platform → PLC Controller')).toBeVisible();
  await expect(page.getByText('it', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('ot', { exact: true }).first()).toBeVisible();

  // 3. The landscape's OT zone — narrow viewport forces the mobile list
  // (a real DOM group, unlike the desktop canvas's own pixel-drawn zone),
  // which groups the OT system under its own "OT" heading, separate from
  // Billing Platform's ordinary Unassigned group.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const otGroup = page.getByRole('button', { name: /^OT\b/ });
  await expect(otGroup).toBeVisible();
  await otGroup.click();
  await expect(page.getByText('PLC Controller')).toBeVisible();
});
