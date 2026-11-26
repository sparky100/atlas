/**
 * An option change that has no edits yet offers the obvious first edit, read from
 * what its decision concerns (no AI): click-only from Home at 1280 and 390. From a
 * finding about "Quote Tool" the owner starts a decision, adds an option, opens it,
 * and is offered "Retire Quote Tool and replace it with a new system", which opens
 * the Retire panel on that change (with its "Replaced by…" choice) and saves nothing.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, homeSearchResult, signUpCreateOrgAndModel } from './fixtures/goldenPath';

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

async function openOptionDraft(page: Page, title: string, kind: 'Keep and tidy up' | 'Buy a product' | 'Build ourselves') {
  await page.getByRole('button', { name: '+ Add an option' }).click();
  // The starter actions follow the stored approach, never the title.
  await page.getByRole('radio', { name: kind, exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(title);
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  // A candidate has no branch until Work on this option creates one.
  await page.getByRole('button', { name: 'Work on this option' }).first().click();
  await expect(page).toHaveURL(/\/changes\//);
  const draftLink = page.getByRole('link', { name: "Draft this option's changes" });
  if (await draftLink.count() > 0) await draftLink.click();
}

test('an empty Buy option offers to retire the system the decision concerns', async ({ page }) => {
  test.slow();
  await startDecisionOnQuoteTool(page, 'optionpredraft');
  await openOptionDraft(page, 'Replace with a product', 'Buy a product');

  // The option page leads with what the option is and one way to start; review waits until there are edits.
  await expect(page.getByRole('heading', { name: 'Replace with a product' })).toBeVisible();
  await expect(page.getByText('Nothing in the model changes unless the decision chooses this option')).toBeVisible();
  await expect(page.getByRole('link', { name: "Draft this option's changes" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove this option…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View this change' })).toHaveCount(0);

  const card = page.getByTestId('option-draft-card');
  await expect(card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' })).toBeVisible();
  await expect(card.getByText('no AI')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  await card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' }).click();
  await expect(page).toHaveURL(/action=retire/);
  await expect(page.getByLabel('Planned end', { exact: true })).toBeVisible();
});

test('an empty Build option offers to retire the existing system and replace it with a custom-built app', async ({ page }) => {
  test.slow();
  await startDecisionOnQuoteTool(page, 'optionbuild');
  await openOptionDraft(page, 'Build ourselves', 'Build ourselves');

  const card = page.getByTestId('option-draft-card');
  const link = card.getByRole('link', { name: 'Retire Quote Tool and replace it with a custom-built app' });
  await expect(link).toBeVisible();
  await expect(card.getByRole('link', { name: /Extend|Create a new system/ })).toHaveCount(0);

  await link.click();
  await expect(page).toHaveURL(/action=retire/);
  await expect(page.getByLabel('Planned end', { exact: true })).toBeVisible();

  // Editing an option, the banner leads back to the decision, and offers no Submit of its own.
  const banner = page.getByRole('status').filter({ hasText: 'Editing in change' });
  await expect(banner.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
  await banner.getByRole('link', { name: 'Back to the decision' }).click();
  await expect(page).toHaveURL(/\/decisions\//);

  // Back at the decision, the option's editing context is left behind: no
  // editing banner, and no "Back to the decision" button pointing at this
  // same page (the loop this regression exists for).
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Editing in change' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to the decision' })).toHaveCount(0);

  // Arriving by nav with the option selected lands the same way: re-open the
  // option for editing (the banner's back link is still offered there), then
  // return via the Decisions nav instead of the banner.
  await page.getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  await expect(page.getByRole('status').filter({ hasText: 'Editing in change' }).getByRole('link', { name: 'Back to the decision' })).toBeVisible();
  await clickNavItem(page, 'Decisions');
  await page.getByRole('link', { name: 'Open →' }).first().click();
  await expect(page.getByRole('heading', { name: 'Keep, link or retire Quote Tool?' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Editing in change' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to the decision' })).toHaveCount(0);
});

test('an empty Keep option offers no starter edit', async ({ page }) => {
  test.slow();
  await startDecisionOnQuoteTool(page, 'optionkeep');
  await openOptionDraft(page, 'Keep and tidy up', 'Keep and tidy up');
  await expect(page.getByText('No change to the landscape recorded.')).toBeVisible();
  await expect(page.getByTestId('option-draft-card')).toHaveCount(0);
});

test('a Buy option offers to retire only the system the decision names, not the capability\'s other supporters', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'optiononlyone');
  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connect a new customer' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Billing Tool', description: 'Bills new customers.', capabilityName: 'Connect a new customer' });
  // Start the decision from Quote Tool itself, so it names that system.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Quote Tool');
  await homeSearchResult(page, 'Quote Tool').click();
  await expect(page.getByRole('heading', { name: 'Quote Tool' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a decision…' }).click();
  // The decision is about the system and the capability it supports, as one started from a capability page and a finding is.
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('Connect a new customer');
  await page.getByRole('button', { name: /Connect a new customer/ }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-outcome')).toBeVisible();

  await openOptionDraft(page, 'Replace with a product', 'Buy a product');
  const card = page.getByTestId('option-draft-card');
  await expect(card.getByRole('link', { name: 'Retire Quote Tool and replace it with a new system' })).toBeVisible();
  await expect(card.getByRole('link', { name: /Billing Tool/ })).toHaveCount(0);
  await expect(card.getByRole('link')).toHaveCount(1);
});
