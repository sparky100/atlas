/**
 * Principles on a decision, click-only from Home at 1280 and 390: write a
 * principle, start a decision, say the decision follows it, then that it
 * departs from it (a reason is required), and see the stance on the
 * Principles page. Once the decision is cancelled the choice is read-only.
 */
import { expect, test } from '@playwright/test';
import { clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a decision follows a principle, then departs from it with a reason; read-only once cancelled', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'decisionprinciples');

  await goToModelHome(page);
  await clickNavItem(page, 'Principles');
  await page.getByRole('button', { name: 'Add principle' }).click();
  await page.getByRole('dialog', { name: 'Add a principle' }).getByLabel('Title').fill('Reuse before buying');
  await page.getByRole('dialog', { name: 'Add a principle' }).getByLabel('The rule').fill('Look at what we already run before we buy something new.');
  await page.getByRole('dialog', { name: 'Add a principle' }).getByRole('button', { name: 'Add principle' }).click();
  await expect(page.getByRole('region', { name: 'Active principles' }).getByRole('heading', { name: 'Reuse before buying' })).toBeVisible();

  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill('What replaces the old CRM');
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'What replaces the old CRM' })).toBeVisible();

  const principles = page.getByRole('button', { name: /^Principles/ });
  await expect(principles).toBeVisible();
  // The section collapses when no principle has a stance yet; open it before reading the list.
  if ((await principles.getAttribute('aria-expanded')) === 'false') await principles.click();
  await expect(page.getByRole('heading', { name: 'Reuse before buying' })).toBeVisible();

  // click(), not check(): the radio is controlled and only reflects the stance once it has been saved and reloaded, so check()'s immediate state assertion would fail; the toBeChecked() below retries until the save lands.
  await page.getByLabel('Follows Reuse before buying').click();
  await expect(page.getByLabel('Follows Reuse before buying')).toBeChecked();

  // A departure needs a reason.
  await page.getByLabel('Departs from Reuse before buying').check();
  await page.getByRole('button', { name: 'Save departure' }).click();
  await expect(page.getByText('A departure needs a reason,')).toBeVisible();
  await page.getByLabel('Why depart from it? (required)').fill('Nothing we own can take the call volume.');
  await page.getByRole('button', { name: 'Save departure' }).click();
  await expect(page.getByLabel('Departs from Reuse before buying')).toBeChecked();

  // The Principles page shows the departure and its reason.
  await clickNavItem(page, 'Principles');
  await expect(page.getByText('Departed from by 1 decision')).toBeVisible();
  await expect(page.getByText('Nothing we own can take the call volume.')).toBeVisible();

  // Back on the decision, cancelling makes the stance read-only.
  await page.getByRole('link', { name: 'What replaces the old CRM' }).click();
  await page.getByRole('button', { name: 'Cancel decision…' }).click();
  await page.getByLabel('Why is this decision being cancelled?').fill('Covered by the platform review instead.');
  await page.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Follows Reuse before buying')).toHaveCount(0);
  await expect(page.getByText('Reason: Nothing we own can take the call volume.')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
