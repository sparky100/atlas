/**
 * ADR-001 amendment ("replaces" relationship type): "Replaces"/"Replaced by"
 * sections render correctly on every side of a consolidation (two retiring
 * elements sharing one replacement) and a split (one retiring element with
 * two replacements) — the plan's own explicit PR2 test requirement. Direction
 * convention: `from = replacement, to = retiring element`, so every edge is
 * added from the replacement's own page via `addReplacesRelationship`
 * (always a plain pick — no staged prompt, unlike supports/uses/flows_to/
 * owns). Click-only from Home (S2's own rule) — moving between already-
 * created elements uses the relationship row's own link, never a fresh Home
 * search or `page.goto`.
 */
import { expect, test } from '@playwright/test';
import { addReplacesRelationship, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('consolidation: two retiring systems replaced by one system render "Replaces"/"Replaced by" on every page', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-replaces-consolidation');

  await addSystemFromHome(page, { name: 'Legacy Billing North', description: 'One of two systems being consolidated.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Billing South', description: 'The other system being consolidated.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Unified Billing Platform', description: 'The replacement for both legacy systems.' });

  // Both edges added from the replacement's own page — `from = replacement`.
  await addReplacesRelationship(page, 'Legacy Billing North');
  await addReplacesRelationship(page, 'Legacy Billing South');

  await expect(page.getByRole('heading', { name: 'replaces (2)' })).toBeVisible();
  const replacesGroup = page.locator('[class*="rowGroup"]');
  await expect(replacesGroup.filter({ hasText: 'Legacy Billing North' })).toBeVisible();
  await expect(replacesGroup.filter({ hasText: 'Legacy Billing South' })).toBeVisible();

  // Follow the row's own link to the first retiring element's page.
  await page.getByRole('link', { name: 'Legacy Billing North' }).click();
  await expect(page.getByRole('heading', { name: 'Legacy Billing North' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'replaced by (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unified Billing Platform' })).toBeVisible();

  // Back to the replacement, then to the second retiring element.
  await page.getByRole('link', { name: 'Unified Billing Platform' }).click();
  await expect(page.getByRole('heading', { name: 'replaces (2)' })).toBeVisible();
  await page.getByRole('link', { name: 'Legacy Billing South' }).click();
  await expect(page.getByRole('heading', { name: 'replaced by (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unified Billing Platform' })).toBeVisible();
});

test('split: one retiring system replaced by two systems renders "Replaces"/"Replaced by" on every page', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-replaces-split');

  await addSystemFromHome(page, { name: 'Monolithic Reporting Suite', description: 'The system being split apart.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Reporting Ingest Service', description: 'One of two replacements after the split.' });
  await addReplacesRelationship(page, 'Monolithic Reporting Suite');

  await expect(page.getByRole('heading', { name: 'replaces (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Monolithic Reporting Suite' })).toBeVisible();

  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Reporting Dashboard Service', description: 'The other replacement after the split.' });
  await addReplacesRelationship(page, 'Monolithic Reporting Suite');

  await expect(page.getByRole('heading', { name: 'replaces (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Monolithic Reporting Suite' })).toBeVisible();

  // Follow the row's own link to the retiring element's page — both
  // replacements should show up as "replaced by".
  await page.getByRole('link', { name: 'Monolithic Reporting Suite' }).click();
  await expect(page.getByRole('heading', { name: 'replaced by (2)' })).toBeVisible();
  const replacedByGroup = page.locator('[class*="rowGroup"]');
  await expect(replacedByGroup.filter({ hasText: 'Reporting Ingest Service' })).toBeVisible();
  await expect(replacedByGroup.filter({ hasText: 'Reporting Dashboard Service' })).toBeVisible();

  // Follow the link back to the other replacement and confirm its own page.
  await page.getByRole('link', { name: 'Reporting Ingest Service' }).click();
  await expect(page.getByRole('heading', { name: 'replaces (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Monolithic Reporting Suite' })).toBeVisible();
});
