/**
 * S2 flow 7 (docs/prompts/atlas-prompt-pack.md): "tag before and after,
 * diff by tag names." Click-only from Home; the "before"/"after" content
 * itself is built by clicking through system creation (S2's own "no
 * seeding beyond org and user" rule) rather than `versions.spec.ts`'s own
 * raw-commit seeding.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('tag main before and after a change, then diff the two tags by name', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath7');

  // Before: one system.
  await addSystemFromHome(page, { name: 'System A', description: 'Exists before the tag.' });
  await goToModelHome(page);

  await page.getByRole('link', { name: 'Versions' }).click();
  const versionList = page.getByRole('list');
  await page.getByPlaceholder('Version name (e.g. v2026-Q2)').fill('v1');
  await page.getByPlaceholder('Note (optional)').fill('Before');
  await page.getByRole('button', { name: 'Tag main now' }).click();
  await expect(versionList.getByText('v1', { exact: true })).toBeVisible();

  // After: a second system added.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'System B', description: 'Added after the first tag.' });
  await goToModelHome(page);

  await page.getByRole('link', { name: 'Versions' }).click();
  await page.getByPlaceholder('Version name (e.g. v2026-Q2)').fill('v2');
  await page.getByPlaceholder('Note (optional)').fill('After');
  await page.getByRole('button', { name: 'Tag main now' }).click();
  await expect(versionList.getByText('v2', { exact: true })).toBeVisible();

  // Diff v1 → v2 by tag name, via the two selects (no URL construction —
  // the resulting href is built by the app, this only clicks the rendered link).
  await page.getByRole('combobox').first().selectOption('tag:v2');
  await page.getByRole('combobox').last().selectOption('tag:v1');
  await page.getByRole('link', { name: 'Diff →' }).click();

  await expect(page.getByRole('heading', { name: 'Diff: v1 → v2' })).toBeVisible();
  await expect(page.getByText('System B')).toBeVisible();
  await expect(page.getByText('Added').first()).toBeVisible();
});
