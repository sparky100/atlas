/**
 * "Connect a new customer": a project started from a system already knows the
 * capability it serves (Simon, 2026-11-19). From the system's own page, "Start a
 * project…" opens a form that already names the capability the system supports,
 * says so, and can be started with no further picking. A system with no
 * capability link recorded says so instead, and still asks for one.
 * Click-only from Home at 1280 and 390.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a project started from a system picks up the capability it supports', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectfromsystem');

  await addCapability(page, 'Bill customers');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Billing Engine', description: 'Calculates bills.', capabilityName: 'Bill customers' });

  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a project…' }).click();
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();

  // The capability is already named, with a sentence saying where it came from.
  await expect(page.getByRole('button', { name: 'Remove Bill customers' })).toBeVisible();
  await expect(page.getByText('Added the capability Billing Engine supports: Bill customers.')).toBeVisible();
  await expect(page.getByText('Name at least one capability this project serves', { exact: false })).toHaveCount(0);

  await page.getByLabel('Architect').selectOption({ index: 1 });
  await expect(page.getByRole('button', { name: 'Start project' })).toBeEnabled();

  // Removing it is respected: it does not come back, and the form asks for one again.
  await page.getByRole('button', { name: 'Remove Bill customers' }).click();
  await expect(page.getByText('Name at least one capability this project serves', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Bill customers' })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test('a system with no capability link recorded says so and still asks for one', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectfromunlinked');

  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues quotes.' });

  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a project…' }).click();
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();

  await expect(page.getByText('Quote Tool has no capability link recorded', { exact: false })).toBeVisible();
  await expect(page.getByText('No business use has been ruled in or out', { exact: false })).toBeVisible();
  await expect(page.getByText('Name at least one capability this project serves', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start project' })).toBeDisabled();
});
