/**
 * Goals, click-only from Home at 1280 and 390: Direction → Goals → add a goal
 * → it shows under Active → edit it → retire it → it shows under Retired →
 * make it active again; and Principles is now reached from the same Direction
 * group. The person who signs up owns the organisation, so they can write goals.
 */
import { expect, test } from '@playwright/test';
import { clickNavItem, expectNavCurrent, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('goals: add, edit, retire and bring back, and Principles lives beside them', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'goals');

  await goToModelHome(page);
  await clickNavItem(page, 'Goals');
  await expect(page.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
  await expectNavCurrent(page, 'Goals');

  await page.getByRole('button', { name: 'Add goal' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add a goal' });
  await addDialog.getByLabel('Title').fill('Cut the time to connect a new customer');
  await addDialog.getByLabel('What success looks like').fill('New customers are connected within ten days.');
  await addDialog.getByRole('button', { name: 'Add goal' }).click();

  const active = page.getByRole('region', { name: 'Active goals' });
  await expect(active.getByRole('heading', { name: 'Cut the time to connect a new customer' })).toBeVisible();
  await expect(active.getByText('Served by 0 capabilities.')).toBeVisible();

  await active.getByRole('button', { name: 'Edit Cut the time to connect a new customer' }).click();
  await active.getByLabel('What success looks like').fill('New customers are connected within seven days.');
  await active.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(active.getByText('within seven days')).toBeVisible();

  await active.getByRole('button', { name: 'Retire Cut the time to connect a new customer' }).click();
  const retired = page.getByRole('region', { name: 'Retired goals' });
  await retired.getByRole('button', { name: 'Show' }).click();
  await expect(retired.getByRole('heading', { name: 'Cut the time to connect a new customer' })).toBeVisible();
  await expect(retired.getByRole('button', { name: /^Edit / })).toHaveCount(0);

  await retired.getByRole('button', { name: 'Make Cut the time to connect a new customer active again' }).click();
  await expect(page.getByRole('region', { name: 'Active goals' }).getByRole('heading', { name: 'Cut the time to connect a new customer' })).toBeVisible();

  await clickNavItem(page, 'Principles');
  await expect(page.getByRole('heading', { name: 'Principles', level: 1 })).toBeVisible();
  await expectNavCurrent(page, 'Principles');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
