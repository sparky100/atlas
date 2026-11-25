/**
 * Walkthrough finding 2 (Simon, 2026-11-20; PROPOSAL-option-approach): a
 * person can tell a Build option from a Buy option at a glance, and renaming
 * an option never changes what kind of option it is. Click-only from Home, at
 * 1280 and 390.
 */
import { expect, test } from '@playwright/test';
import { addCapability, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('say what kind of option it is when adding it, change it later, and it survives a reload', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'optapproach');
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByTestId('start-project-decision')).toBeVisible();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Adding by hand asks what kind of option it is; "Not decided yet" is the default.
  await page.getByRole('button', { name: '+ Add an option' }).click();
  const kind = page.getByRole('group', { name: 'What kind of option is this?' });
  await expect(kind.getByRole('radio', { name: 'Not decided yet' })).toBeChecked();
  await kind.getByRole('radio', { name: 'Build ourselves' }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Quote engine on our own platform');
  await page.getByRole('button', { name: 'Add option' }).click();

  const label = page.getByRole('combobox', { name: 'What kind of option is “Quote engine on our own platform”?' }).first();
  await expect(label).toHaveValue('build');

  // Changing it keeps the option and its name.
  await label.selectOption('buy');
  await expect(label).toHaveValue('buy');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'What kind of option is “Quote engine on our own platform”?' }).first()).toHaveValue('buy');
  await expect(page.getByText('Quote engine on our own platform').first()).toBeVisible();
});
