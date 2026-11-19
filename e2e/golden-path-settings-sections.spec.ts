/**
 * Settings pages, click-only from Home at 1280 and 390: Organisation settings
 * opens with only its first section expanded, each section opens and closes
 * from its header, Expand all / Collapse all work, the choice survives a
 * reload, and nothing overflows the screen.
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('settings sections: first one open, toggle, expand all, remembered after reload', async ({ page }) => {
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath-sections');

  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();

  const organisation = page.getByRole('button', { name: /^Organisation/ });
  const review = page.getByRole('button', { name: /^Review reminders/ });
  const reviewField = page.getByLabel('Days to review');

  // Only the first section starts open.
  await expect(organisation).toHaveAttribute('aria-expanded', 'true');
  await expect(review).toHaveAttribute('aria-expanded', 'false');
  await expect(reviewField).toBeHidden();

  // A closed section still says what it is set to.
  await expect(review).toContainText('days to review');

  await review.click();
  await expect(reviewField).toBeVisible();

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(organisation).toHaveAttribute('aria-expanded', 'false');
  await expect(reviewField).toBeHidden();

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(reviewField).toBeVisible();
  await expect(page.getByTestId('settings-section-delete').locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');

  // Remembered after a reload.
  await review.click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Review reminders/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /^Organisation/ })).toHaveAttribute('aria-expanded', 'true');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
