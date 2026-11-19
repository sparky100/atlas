/**
 * An option change that has no edits yet offers the obvious first edit, read from
 * what its decision concerns (no AI): click-only from Home at 1280 and 390. From a
 * finding about "Quote Tool" the owner starts a decision, adds an option, opens it,
 * and is offered "Retire Quote Tool and replace it with a new system", which opens
 * the Retire panel on that change (with its "Replaced by…" choice) and saves nothing.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('an empty option offers to retire the system the decision concerns', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'optionpredraft');
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });
  await goToModelHome(page);
  await expect(page.getByTestId('health-findings-panel').getByText('Loading…')).toHaveCount(0);
  await page.getByTestId('health-findings-panel').getByRole('link', { name: 'Keep, link or retire? →' }).click();
  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();

  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Buy a new quoting product');
  await page.getByRole('button', { name: 'Add option' }).click();
  await page.getByRole('link', { name: 'Buy a new quoting product' }).first().click();

  const card = page.getByTestId('option-draft-card');
  await expect(card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' })).toBeVisible();
  await expect(card.getByText('no AI')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  await card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' }).click();
  await expect(page).toHaveURL(/action=retire/);
  await expect(page.getByLabel('Planned end', { exact: true })).toBeVisible();
});
