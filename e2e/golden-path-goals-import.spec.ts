/**
 * Importing goals, click-only from Home at 1280 and 390: Import → Import goals →
 * choose a file → the preview says what will be added → Add goals → the goals
 * show on Goals with their capability; importing the same file again adds nothing.
 * The person who signs up owns the organisation, so they can import goals.
 */
import { expect, test } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const CSV = ['Title,What success looks like,Why now,Capabilities', 'Cut connection time,Customers connected in ten days,Contract ends,Connect Customers; Unknown Thing', 'Pay on time,Everyone paid on the day,,'].join('\n');

test('goals: import from a file, preview first, and a second import adds nothing', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'goalsimport');
  await addCapability(page, 'Connect Customers');

  await goToModelHome(page);
  await clickNavItem(page, 'Import');
  const section = page.getByRole('group', { name: 'Import goals' });
  await expect(section).toBeVisible();

  await section.getByLabel('Goals file (.xlsx or .csv)').setInputFiles({ name: 'goals.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(section.getByText('Ready to add 2 goals.')).toBeVisible();
  await expect(section.getByText(/1 capability name matches no single capability/)).toBeVisible();
  await section.getByRole('button', { name: 'Add 2 goals' }).click();
  await expect(section.getByText('Added 2 goals.')).toBeVisible();

  await section.getByRole('link', { name: 'See them on Goals' }).click();
  const active = page.getByRole('region', { name: 'Active goals' });
  await expect(active.getByRole('heading', { name: 'Cut connection time' })).toBeVisible();
  await expect(active.getByRole('heading', { name: 'Pay on time' })).toBeVisible();
  await expect(active.getByText('Served by 1 capability.')).toBeVisible();

  await goToModelHome(page);
  await clickNavItem(page, 'Import');
  await page.getByRole('group', { name: 'Import goals' }).getByLabel('Goals file (.xlsx or .csv)').setInputFiles({ name: 'goals.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByText('Nothing new to add.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add goals' })).toBeDisabled();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
