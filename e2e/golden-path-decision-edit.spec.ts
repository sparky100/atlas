/**
 * Edit a proposed decision — click-only from Home, at 1280 and 390: start
 * a decision with a typo and no context or concerns, then fix the title,
 * add context and a needed-by date, and add a capability it concerns; all
 * of it shows on the page. Once cancelled, it can no longer be edited.
 */
import { expect, test } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('edit a proposed decision: title, context, needed-by date and a concern; closed to edits once cancelled', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'decisionedit');
  await addCapability(page, 'Data Governance');

  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill('What to replce BW with');
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'What to replce BW with' })).toBeVisible();
  await expect(page.getByText('No context recorded.')).toBeVisible();
  await expect(page.getByPlaceholder('Add a capability or system this decision concerns…')).toBeVisible();

  // Fix the title, add context and a needed-by date.
  await page.getByRole('button', { name: '✎ Edit decision' }).click();
  await page.getByLabel('Title').fill('What to replace BW with');
  await page.getByLabel('Context').fill('BW goes out of support in 2027.');
  await page.getByLabel('Needed by').fill('2026-12-31');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What to replace BW with' })).toBeVisible();
  await expect(page.getByText('BW goes out of support in 2027.')).toBeVisible();
  await expect(page.getByText('Needed by: 2026-12-31')).toBeVisible();
  await expect(page.getByRole('button', { name: '✎ Edit decision' })).toBeVisible();

  // Add a capability it concerns.
  await page.getByPlaceholder('Add a capability or system this decision concerns…').fill('Data Gov');
  await page.getByRole('button', { name: 'Data Governance' }).click();
  await expect(page.getByRole('link', { name: 'Data Governance' })).toBeVisible();

  // Once cancelled, nothing on it can be edited.
  await page.getByRole('button', { name: 'Cancel decision…' }).click();
  await page.getByLabel('Why is this decision being cancelled?').fill('Covered by the platform review instead.');
  await page.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '✎ Edit decision' })).toHaveCount(0);
  await expect(page.getByPlaceholder('Add a capability or system this decision concerns…')).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
