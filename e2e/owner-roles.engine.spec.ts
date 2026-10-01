/**
 * Prompt 7k item 2: owner roles. The prompt pack's own combined Playwright
 * line: "add a technical owner alongside a business owner." Also covers
 * "the picker asks for the role on systems, defaults to business on
 * capabilities" and "Element page and context header list owners by role
 * ('Business owner: Housing · Technical owner: IT Operations')."
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('adding an owner on a system asks for a role; a second owner in a different role adds alongside, not instead of, the first', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'ownerroles', 'Billing Service');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId, userId: ownerId } = fixture;

  // Two actors, seeded directly (the members_insert-adjacent "seed via a
  // real commit" pattern every other spec in this suite uses for fixture
  // data the UI itself doesn't need to create) — the role picker is what
  // this test actually exercises, not actor creation.
  const main = await getMainBranch(owner, modelId);
  if (!main) throw new Error('main branch missing');
  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const housingId = randomUUID();
  const itOpsId = randomUUID();
  const actorDeltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: housingId, elementType: 'actor', name: 'Housing', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: itOpsId, elementType: 'actor', name: 'IT Operations', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed two actors', body: null, deltas: actorDeltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed actors: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=main`);
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();

  // 1. Add Housing as the owner — a system target, so the role picker asks.
  await page.getByRole('button', { name: '+ Add owned by' }).click();
  await page.getByPlaceholder('Search…').fill('Housing');
  await page.getByRole('button', { name: 'Housing', exact: false }).click();
  await expect(page.getByText('What role does Housing have for Billing Service?')).toBeVisible();
  await page.getByRole('button', { name: 'Business' }).click();
  await expect(page.getByText('business owner', { exact: false })).toBeVisible({ timeout: 15_000 });

  // 2. Add IT Operations as a second owner, a different role — both stay
  // (Prompt 7k item 2: up to three owners at once, one per role), not a
  // replacement of Housing the way B4's supports "primary" demotion works.
  await page.getByRole('button', { name: '+ Add owned by' }).click();
  await page.getByPlaceholder('Search…').fill('IT Operations');
  await page.getByRole('button', { name: 'IT Operations', exact: false }).click();
  await expect(page.getByText('What role does IT Operations have for Billing Service?')).toBeVisible();
  await page.getByRole('button', { name: 'Technical' }).click();
  await expect(page.getByText('technical owner', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('business owner', { exact: false })).toBeVisible();

  // 3. The context page's header lists both, grouped by role.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}?ref=main`);
  // The whole owners line (each role is its own span inside it).
  const ownerLine = page.getByRole('paragraph').filter({ hasText: 'Business owner:' });
  await expect(ownerLine).toBeVisible();
  await expect(ownerLine.getByRole('link', { name: 'Housing' })).toBeVisible();
  await expect(ownerLine.getByRole('link', { name: 'IT Operations' })).toBeVisible();
  const ownerLineText = await ownerLine.innerText();
  expect(ownerLineText.indexOf('Business')).toBeLessThan(ownerLineText.indexOf('Technical'));
});
