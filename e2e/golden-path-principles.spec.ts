/**
 * Principles, click-only from Home at 1280 and 390: Work → Principles → add a
 * principle → it shows under Active → edit it → retire it → it shows under
 * Retired → make it active again. The person who signs up owns the
 * organisation, so they can write principles.
 */
import { expect, test } from '@playwright/test';
import { clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('principles: add, edit, retire and bring back', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'principles');

  await goToModelHome(page);
  await clickNavItem(page, 'Principles');
  await expect(page.getByRole('heading', { name: 'Principles', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Add principle' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add a principle' });
  await addDialog.getByLabel('Title').fill('Reuse before buying');
  await addDialog.getByLabel('The rule').fill('Look at what we already run before we buy something new.');
  await addDialog.getByRole('button', { name: 'Add principle' }).click();

  const active = page.getByRole('region', { name: 'Active principles' });
  await expect(active.getByRole('heading', { name: 'Reuse before buying' })).toBeVisible();
  await expect(active.getByText('Followed by 0 decisions. Departed from by 0 decisions.')).toBeVisible();

  await active.getByRole('button', { name: 'Edit Reuse before buying' }).click();
  await active.getByLabel('The rule').fill('Look at what we already run, then what we can buy, before we build.');
  await active.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(active.getByText('then what we can buy, before we build')).toBeVisible();

  await active.getByRole('button', { name: 'Retire Reuse before buying' }).click();
  const retired = page.getByRole('region', { name: 'Retired principles' });
  await retired.getByRole('button', { name: 'Show' }).click();
  await expect(retired.getByRole('heading', { name: 'Reuse before buying' })).toBeVisible();
  await expect(retired.getByRole('button', { name: /^Edit / })).toHaveCount(0);

  await retired.getByRole('button', { name: 'Make Reuse before buying active again' }).click();
  await expect(page.getByRole('region', { name: 'Active principles' }).getByRole('heading', { name: 'Reuse before buying' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
