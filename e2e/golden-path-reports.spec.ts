/**
 * F9 step 3 (UI-principles §2.0): the Reports hub, click-only from Home
 * (S2's own rule), at 1280 and 390 like every `golden-path-*` spec. One
 * real IT/OT boundary crossing is built through the UI first (an IT system
 * that uses an OT one), so the hub shows a real non-zero count next to
 * real zeros — then every report is opened from the hub, with the nav's
 * Reports item staying current throughout.
 */
import { expect, test, type Page } from '@playwright/test';
import { addSystemFromHome, addUsesRelationship, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function setDomain(page: Page, domain: 'it' | 'ot'): Promise<void> {
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Domain', { exact: true }).selectOption(domain);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible({ timeout: 15_000 });
}

test('Reports: reach every standing report from the nav, see its real count, and open it', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-reports');

  await addSystemFromHome(page, { name: 'Grid Sensor Hub', description: 'Collects substation sensor readings.' });
  await setDomain(page, 'ot');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Asset Register', description: 'The register of network assets.' });
  await setDomain(page, 'it');
  await addUsesRelationship(page, 'Grid Sensor Hub', 'reads sensor readings from');
  // The link is saved once it shows on the page — only then is it on main for the hub to count.
  await expect(page.getByText('reads sensor readings from').first()).toBeVisible({ timeout: 15_000 });

  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  const reportsItem = nav.getByRole('link', { name: 'Reports' });
  await reportsItem.click();
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(reportsItem).toHaveAttribute('aria-current', 'page');

  // Each count is what the report behind it lists: the one crossing built
  // above, and genuine zeros everywhere else (no duplicate check has run).
  await expect(page.getByText('1 crossing', { exact: true })).toBeVisible();
  await expect(page.getByText('0 interfaces missing a data classification', { exact: true })).toBeVisible();
  await expect(page.getByText('0 external organisations with access', { exact: true })).toBeVisible();
  await expect(page.getByText('0 possible duplicates', { exact: true })).toBeVisible();
  // Once every count is in, no "Loading…" line is left behind beside them.
  await expect(page.getByRole('main').getByText('Loading…', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Open Boundary crossings' }).click();
  await expect(page.getByRole('heading', { name: 'Boundary crossings', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Asset Register' }).first()).toBeVisible();
  await expect(reportsItem).toHaveAttribute('aria-current', 'page');

  await reportsItem.click();
  await page.getByRole('link', { name: 'Open External interfaces' }).click();
  await expect(page.getByRole('heading', { name: 'External interfaces', level: 1 })).toBeVisible();
  await expect(reportsItem).toHaveAttribute('aria-current', 'page');

  await reportsItem.click();
  await page.getByRole('link', { name: 'Open Duplicates' }).click();
  await expect(page.getByRole('heading', { name: 'Duplicates report', level: 1 })).toBeVisible();
  await expect(reportsItem).toHaveAttribute('aria-current', 'page');

  // No horizontal overflow on the hub (meaningful at 390).
  await reportsItem.click();
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
