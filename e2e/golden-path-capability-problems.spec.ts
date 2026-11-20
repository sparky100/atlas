/**
 * Simon, 2026-11-20: a capability page shows what needs attention first, and
 * "Start a project" is a visible button there, not buried in the ⋯ menu.
 * A poor fit is a prompt, never a verdict. Click-only from Home, at 1280 and 390.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, homeSearchResult, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a capability page leads with its problem and starts a project from it', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'capproblems');

  await addCapability(page, 'Connection Quotations');
  await addCapability(page, 'Handle a fault');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connection Quotations' });
  await expect(page.getByRole('heading', { name: 'Quote Tool' })).toBeVisible();

  // Rate the supports link a poor fit.
  await page.getByRole('button', { name: 'Show attributes' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Fit notes stay out of the way until a poor or adequate fit asks "What is the problem?".
  await expect(page.getByLabel('What is the problem?')).toHaveCount(0);
  await page.getByLabel('Fit for purpose').selectOption('poor');
  await page.getByLabel('What is the problem?').fill('Quotes are keyed by hand and take two days.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Fit for purpose: poor', { exact: false })).toBeVisible();

  // Open the capability: the problem comes first, in plain words, and never says replace or retire.
  await page.getByRole('link', { name: 'Connection Quotations' }).first().click();
  const band = page.getByTestId('capability-problems');
  await expect(band.getByRole('heading', { name: 'What needs attention' })).toBeVisible();
  await expect(band.getByRole('link', { name: 'Quote Tool' })).toBeVisible();
  await expect(band).toContainText('Quote Tool is a poor fit.');
  await expect(band).toContainText('Quotes are keyed by hand and take two days.');
  await expect(band).not.toContainText(/replace|retire/i);

  // One visible button, not only in the ⋯ menu; the capability is already the scope.
  await band.getByRole('link', { name: 'Start a project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Connection Quotations' })).toBeVisible();
  // The reason already written is the starting purpose, with where it came from; nothing is retyped.
  await expect(page.getByLabel('Purpose')).toHaveValue(/Quote Tool: Quotes are keyed by hand and take two days\. \(From the fit note on Quote Tool\.\)/);

  // A capability nothing supports says so, with the same button.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Handle a fault');
  await homeSearchResult(page, 'Handle a fault').click();
  await expect(page.getByRole('heading', { name: 'Handle a fault' })).toBeVisible();
  await expect(page.getByTestId('capability-problems')).toContainText('No system is recorded as supporting this capability.');
  await expect(page.getByTestId('capability-problems').getByRole('link', { name: 'Start a project', exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
