/**
 * Live connectors (ADR-032), click-only from Home: an owner reads the set-up
 * steps, saves a MuleSoft connection (the secret goes in, is never shown
 * again), sees it as connected, and removes it. "Test connection" and "Fetch
 * from MuleSoft" call a deployed `connector-fetch` function and a real
 * Anypoint organisation, which this suite does not have, so they are covered
 * by `src/connectors/connectors.test.ts` instead. Runs at 1280 and 390.
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';
import { expandAllSettingsSections } from './fixtures/settings';

test('Connections: an owner saves a MuleSoft connection, the secret is never shown again, then removes it', async ({ page }) => {
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath-connectors');
  await page.getByRole('link', { name: 'Atlas', exact: true }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expandAllSettingsSections(page);

  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
  const connection = page.getByRole('group', { name: 'MuleSoft Anypoint connection' });
  await expect(page.getByText('Not connected')).toBeVisible();
  await page.getByText('How to set this up in Anypoint').click();
  await expect(page.getByText('acts on its own behalf')).toBeVisible();

  await page.getByLabel('Organisation ID').fill('11111111-2222-3333-4444-555555555555');
  await page.getByLabel('Client ID').fill('client-id-1234567890');
  await page.getByLabel('Client secret').fill('the-secret-value-1234');
  await page.getByLabel('Environments to read (separate with commas)').fill('Production, Sandbox');
  await connection.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Client secret')).toHaveValue('');
  await expect(page.getByLabel('Client secret')).toHaveAttribute('placeholder', /Saved/);
  await expect(page.getByText('the-secret-value-1234')).toHaveCount(0);

  // Saved settings come back after a reload; the secret does not.
  await page.reload();
  await expect(page.getByLabel('Client ID')).toHaveValue('client-id-1234567890');
  await expect(page.getByLabel('Environments to read (separate with commas)')).toHaveValue('Production, Sandbox');
  await expect(page.getByLabel('Client secret')).toHaveValue('');

  await page.getByRole('button', { name: 'Remove connection' }).click();
  await page.getByRole('button', { name: 'Yes, remove it' }).click();
  await expect(page.getByText('Not connected')).toBeVisible();
});
