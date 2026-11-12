/**
 * Stale-data settings, click-only from Home at 1280 and 390: an owner changes
 * how many months before something counts as out of date (Organisation
 * settings), and each person can switch the "things I own haven't been
 * checked" email off (Profile). Both survive a reload. The list itself and
 * the reminder email need data older than a test run can create, so they are
 * covered by `src/db/staleNudge.integration.test.ts` and the unit tests.
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('stale data: set the months threshold and the email opt-out, both persist', async ({ page }) => {
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath-stale');

  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Out-of-date information' })).toBeVisible();
  const months = page.getByLabel('Months before it is out of date');
  await expect(months).toHaveValue('12');
  await months.fill('6');
  await months.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await expect(page.getByLabel('Months before it is out of date')).toHaveValue('6');

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Profile' }).click();
  const staleEmail = page.getByLabel("Email me when things I own haven't been checked for a while");
  await expect(staleEmail).toBeChecked();
  await staleEmail.uncheck();
  await page.reload();
  await expect(page.getByLabel("Email me when things I own haven't been checked for a while")).not.toBeChecked();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
