/**
 * Goals on the capability map and Home, click-only from Home at 1280 and 390:
 * a goal with no capability → Home says so → Goals → serve a capability →
 * Capability map → Show goal → the capability says "Serves this goal".
 */
import { expect, test } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('goals: Home count and Show goal on the capability map', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'goalsmap');

  await addCapability(page, 'Connect Customers');
  await goToModelHome(page);
  await clickNavItem(page, 'Goals');
  await page.getByRole('button', { name: 'Add goal' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add a goal' });
  await addDialog.getByLabel('Title').fill('Cut the time to connect a new customer');
  await addDialog.getByLabel('What success looks like').fill('New customers are connected within ten days.');
  await addDialog.getByRole('button', { name: 'Add goal' }).click();
  const active = page.getByRole('region', { name: 'Active goals' });
  await expect(active.getByRole('heading', { name: 'Cut the time to connect a new customer' })).toBeVisible();

  await goToModelHome(page);
  await expect(page.getByText(/1 goal has no capability linked yet/)).toBeVisible();

  await clickNavItem(page, 'Goals');
  await page.getByRole('region', { name: 'Active goals' }).getByLabel('Add a capability').selectOption({ label: 'Connect Customers' });
  await page.getByRole('button', { name: 'Add the chosen capability to Cut the time to connect a new customer' }).click();
  await expect(page.getByText('Served by 1 capability.')).toBeVisible();

  await goToModelHome(page);
  await expect(page.getByText(/no capability linked yet/)).toHaveCount(0);

  await clickNavItem(page, 'Capability map');
  await expect(page.getByText('Connect Customers').first()).toBeVisible();
  const showGoal = page.getByLabel('Show goal');
  if (!(await showGoal.isVisible())) await page.getByRole('button', { name: /Filters/ }).first().click();
  await showGoal.selectOption({ label: 'Cut the time to connect a new customer' });
  await expect(page.getByText(/Serves this goal|serves? this goal/).first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
