import { expect, test } from '@playwright/test';
import { clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';
import { expandAllSettingsSections } from './fixtures/settings';

test('enable Draft with AI and send a change brief to capture review', async ({ page }) => {
  const { orgName, modelName } = await signUpCreateOrgAndModel(page, 'goldenpath-ai-draft');
  await goToModelHome(page);
  await clickNavItem(page, 'Changes');
  await expect(page.getByRole('heading', { name: 'Changes', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Describe your own' })).toHaveCount(0);
  await expect(page.getByText('Draft with AI is off for this organisation.')).toBeVisible();

  await clickNavItem(page, 'Ask Atlas');
  await page.getByRole('link', { name: 'organisation settings' }).click();
  await expandAllSettingsSections(page);
  const allow = page.getByLabel('Allow Ask Atlas for this organisation');
  await allow.click();
  await expect(allow).toBeChecked();
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: modelName }).click();
  await clickNavItem(page, 'Changes');

  // Storage and the job insert remain real. Stub only the edge invocation
  // because a local run has no configured AI provider.
  const captureRun = page.waitForRequest('**/functions/v1/capture-run');
  await page.route('**/functions/v1/capture-run', async (route) => {
    await route.fulfill({ json: { status: 'noop', jobStatus: 'pending' } });
  });
  await expect(page.getByText('Draft with AI is off for this organisation.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add an integration' })).toBeVisible();
  await page.getByRole('button', { name: 'Describe your own' }).click();
  await page.getByLabel('Change title').fill('Replace the CRM');
  await page.getByLabel('Change brief').fill('Introduce NextCRM to support Customer Onboarding first.');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.getByRole('heading', { name: 'Capture review' })).toBeVisible();
  await expect(page.getByText('Generating proposed edits…')).toBeVisible();
  expect((await captureRun).postData()).toContain(page.url().split('/').at(-1));
});
