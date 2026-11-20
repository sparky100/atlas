/**
 * An option change that has no edits yet offers the obvious first edit, read from
 * what its decision concerns (no AI): click-only from Home at 1280 and 390. From a
 * finding about "Quote Tool" the owner starts a decision, adds an option, opens it,
 * and is offered "Retire Quote Tool and replace it with a new system", which opens
 * the Retire panel on that change (with its "Replaced by…" choice) and saves nothing.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function startDecisionOnQuoteTool(page: Page, handle: string) {
  await signUpCreateOrgAndModel(page, handle);
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });
  await goToModelHome(page);
  await expect(page.getByTestId('health-findings-panel').getByText('Loading…')).toHaveCount(0);
  await page.getByTestId('health-findings-panel').getByRole('link', { name: 'Keep, link or retire? →' }).click();
  await page.getByRole('combobox').first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();
}

async function openOptionDraft(page: Page, title: string) {
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(title);
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  await page.getByRole('link', { name: 'View diagram →' }).first().click();
  await page.getByTestId('option-diagram-no-edits').getByRole('link', { name: 'Draft the obvious edits →' }).click();
}

test('an empty Replace option offers to retire the system the decision concerns', async ({ page }) => {
  test.slow();
  await startDecisionOnQuoteTool(page, 'optionpredraft');
  await openOptionDraft(page, 'Replace with a product');

  const card = page.getByTestId('option-draft-card');
  await expect(card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' })).toBeVisible();
  await expect(card.getByText('no AI')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  await card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' }).click();
  await expect(page).toHaveURL(/action=retire/);
  await expect(page.getByLabel('Planned end', { exact: true })).toBeVisible();
});

test('an empty Build option offers to create a new system, not to retire or extend one', async ({ page }) => {
  test.slow();
  await startDecisionOnQuoteTool(page, 'optionbuild');
  await openOptionDraft(page, 'Build ourselves');

  const card = page.getByTestId('option-draft-card');
  await expect(card.getByRole('link', { name: 'Create a new system' })).toBeVisible();
  await expect(card.getByRole('link', { name: /Retire|Extend/ })).toHaveCount(0);

  await card.getByRole('link', { name: 'Create a new system' }).click();
  await expect(page).toHaveURL(/add=system/);
  await expect(page.getByText("Type the application's name.", { exact: false })).toBeVisible();
});

test('an empty Keep option offers no starter edit', async ({ page }) => {
  test.slow();
  await startDecisionOnQuoteTool(page, 'optionkeep');
  await openOptionDraft(page, 'Keep and tidy up');
  await expect(page.getByText('Nothing has been changed yet.')).toBeVisible();
  await expect(page.getByTestId('option-draft-card')).toHaveCount(0);
});
