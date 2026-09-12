/**
 * S1 item 11 (docs/prompts/atlas-prompt-pack.md, issue #115): "`version:
 * text` on system and container, shown by lifecycle in the header,
 * editable, in diffs and history."
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('setting a system\'s version shows it in the header next to lifecycle, is editable, and diffs by label not key', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'sysversion', 'Payments Gateway');
  const { orgSlug, modelSlug, systemId } = fixture;

  // Tag v1 before the version is set — the diff below needs a real "before".
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/versions`);
  await page.getByPlaceholder('Version name (e.g. v2026-Q2)').fill('v1');
  await page.getByRole('button', { name: 'Tag main now' }).click();
  await expect(page.getByRole('list').getByText('v1', { exact: true })).toBeVisible();

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: 'Payments Gateway' })).toBeVisible();
  // Not set yet — no version text in the header.
  await expect(page.getByText('3.4.1')).toHaveCount(0);

  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Version').fill('3.4.1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  // Shown in the header, next to the lifecycle Chip — not just buried in
  // the attributes list below.
  const header = page.locator('header');
  await expect(header.getByText('active', { exact: true })).toBeVisible();
  await expect(header.getByText('3.4.1', { exact: true })).toBeVisible();

  // Tag v2, then diff v1 → v2: the changed row names "Version", never the
  // raw storage key "version" (S1 item 10's own generic label machinery).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/versions`);
  await page.getByPlaceholder('Version name (e.g. v2026-Q2)').fill('v2');
  await page.getByRole('button', { name: 'Tag main now' }).click();
  await expect(page.getByRole('list').getByText('v2', { exact: true })).toBeVisible();

  await page.getByRole('combobox').first().selectOption('tag:v2');
  await page.getByRole('combobox').last().selectOption('tag:v1');
  await page.getByRole('link', { name: 'Diff →' }).click();
  await expect(page.getByRole('heading', { name: 'Diff: v1 → v2' })).toBeVisible();
  await expect(page.getByText('Version', { exact: true })).toBeVisible();
  await expect(page.getByText('version', { exact: true })).toHaveCount(0);
});

test('a container also gets an editable version, independent of its parent system\'s own', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'containerversion', 'SAP');
  const { signedIn, orgSlug, modelSlug, modelId, main, seedSourceId, systemId } = fixture;

  // A container needs its own seeded delta (Container creation isn't
  // reachable through the ordinary UI unless the parent system is a
  // platform — `ModulesSection`'s own "+ Add module" gate) — seeded
  // directly, same as e.g. architect-door-health-findings.spec.ts already
  // does for elements a test doesn't need to click through the UI to create.
  const containerId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a container',
    body: null,
    deltas: [{ kind: 'element.create', id: randomUUID(), elementId: containerId, elementType: 'container', name: 'FI', parentId: systemId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 }],
  };
  const result = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) throw new Error(`seeding container: ${result.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${containerId}`);
  await expect(page.getByRole('heading', { name: 'FI' })).toBeVisible();

  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Version').fill('2026-Q1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  const header = page.locator('header');
  await expect(header.getByText('2026-Q1', { exact: true })).toBeVisible();
});
