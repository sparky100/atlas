/**
 * Simon, 2026-11-25: "Listing the products doesn't help create an option."
 * Click-only from Home at 1280 and 390: seed the electricity starter map,
 * open Connection Quotations, start a decision about it, add a Buy option,
 * and turn a listed reviewed product into its own option with one click. The
 * new option is a candidate (no change), carries the product as its source
 * after a reload, and the product now says "Already an option".
 *
 * Test setup, not production paths: Playwright's global setup publishes the
 * repository's electricity catalogue v1 locally. Saving the option and its
 * source goes to the real database through RLS; the cross-organisation
 * boundary is in productCatalogue.integration.test.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { goToModelHome, seedStarterCapabilityMap, signUpCreateOrgAndModel } from './fixtures/goldenPath';
import { optionSurface } from './fixtures/decisionLayout';

/** The search dialog, as a user at this width opens it (same as golden-path-search-and-landscape-find). */
async function openSearch(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  if ((page.viewportSize()?.width ?? 1280) > 768) {
    await expect(async () => {
      await page.keyboard.press('Control+K');
      await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 10_000 });
    return;
  }
  await nav.getByRole('button', { name: /^More/ }).click();
  await nav.getByRole('region', { name: 'More sections' }).getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
}

test('a listed product becomes an option in one click, with the product saved as its source', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'productoption');
  await seedStarterCapabilityMap(page, /^Electricity Network Operator$/);
  await goToModelHome(page);

  await openSearch(page);
  await page.getByLabel('Search elements, changes, decisions and projects').fill('Connection Quotations');
  await page.getByRole('option', { name: /Connection Quotations/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Connection Quotations' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a decision…' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-outcome')).toBeVisible();

  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByRole('radio', { name: 'Buy a product', exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Buy a quoting product');
  await page.getByRole('button', { name: 'Add option' }).click();
  const grid = page.getByTestId('decision-criteria-grid');
  await expect(grid.getByText('Buy a quoting product').first()).toBeVisible();

  // The reviewed products for the capability are listed, each with one action.
  const products = page.getByTestId('capability-products');
  const product = products.getByRole('listitem').filter({ hasText: 'Salesforce Energy and Utilities Cloud' }).first();
  await expect(product).toBeVisible();
  await product.getByRole('button', { name: 'Make it an option' }).click();
  await expect(product.getByText('Added a new option: Use Salesforce Energy and Utilities Cloud.')).toBeVisible();
  await expect(grid.getByText('Use Salesforce Energy and Utilities Cloud').first()).toBeVisible();

  await page.reload();
  await expect(grid.getByText('Use Salesforce Energy and Utilities Cloud').first()).toBeVisible();
  // A candidate: no change was made for either option.
  await expect(grid.getByRole('button', { name: 'Work on this option' })).toHaveCount(2);
  await expect(page.getByTestId('capability-products').getByRole('listitem').filter({ hasText: 'Salesforce Energy and Utilities Cloud' }).first()
    .getByRole('button', { name: 'Already an option' })).toBeDisabled();
  if ((page.viewportSize()?.width ?? 1280) < 700) await grid.getByText('Details and evidence').last().click();
  await grid.getByRole('button', { name: 'Sources (1)' }).first().click();
  await expect(grid.getByText('Salesforce Energy and Utilities Cloud — Salesforce').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

/** Simon, 2026-11-26: approach first, then product. */
test('choosing Buy starts a product decision with the need, outcome and products carried over, and the two are linked', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'productdecision');
  await seedStarterCapabilityMap(page, /^Electricity Network Operator$/);
  await goToModelHome(page);

  await openSearch(page);
  await page.getByLabel('Search elements, changes, decisions and projects').fill('Connection Quotations');
  await page.getByRole('option', { name: /Connection Quotations/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Connection Quotations' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a decision…' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-outcome')).toBeVisible();
  const approachUrl = page.url();

  const card = page.getByTestId('decision-next-step');
  await card.getByRole('button', { name: 'Add the outcome' }).click();
  await page.getByTestId('decision-edit-outcome').getByLabel('Outcome: what will be better, for whom, by when').fill('Issue a quote in two days, not ten, by March 2027');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('decision-outcome')).toContainText('Issue a quote in two days, not ten, by March 2027');

  // The approach: a Buy option, chosen before any product is picked.
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByRole('radio', { name: 'Buy a product', exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Buy a quoting product');
  await page.getByRole('button', { name: 'Add option' }).click();
  const buy = optionSurface(page, 'Buy a quoting product');
  await expect(buy).toBeVisible();
  await buy.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('A product is quicker than building one.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect(page.getByText('accepted', { exact: true }).first()).toBeVisible();

  // There is nothing to deliver until a product is picked, so the next step is the product decision.
  await expect(card).toContainText('Choose the product');
  await card.getByRole('button', { name: 'Start the product decision' }).click();
  await expect(page.getByRole('heading', { name: 'Which product for: Buy a quoting product?' })).toBeVisible();
  await expect(page).not.toHaveURL(approachUrl);
  await expect(page.getByTestId('decision-follows')).toContainText('Buy a quoting product');
  // Carried over: the outcome, the capability, and the reviewed products as options beside staying as we are.
  await expect(page.getByTestId('decision-outcome')).toContainText('Issue a quote in two days, not ten, by March 2027');
  await expect(page.getByRole('link', { name: 'Connection Quotations' }).first()).toBeVisible();
  await expect(optionSurface(page, 'Use Salesforce Energy and Utilities Cloud')).toBeVisible();
  await expect(optionSurface(page, 'Use Microsoft Dynamics 365 Customer Service')).toBeVisible();
  await expect(page.getByTestId('decision-next-step')).toContainText('Choose an option');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);

  // Back on the approach decision, its Buy option says the product decision is under way.
  await page.getByTestId('decision-follows').getByRole('link').click();
  await expect(page.getByTestId('decision-next-step')).toContainText('Choosing the product');
  await page.getByTestId('decision-next-step').getByRole('button', { name: 'Open the product decision' }).click();
  await expect(page.getByRole('heading', { name: 'Which product for: Buy a quoting product?' })).toBeVisible();
});
