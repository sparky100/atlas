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
import { addContainerFromHome, addSystemFromHome, goToModelHome, seedStarterCapabilityMap, signUpCreateOrgAndModel } from './fixtures/goldenPath';
import { optionSurface } from './fixtures/decisionLayout';

/** The search dialog, as a user at this width opens it (same as golden-path-search-and-landscape-find). */
async function openSearch(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  if ((page.viewportSize()?.width ?? 1280) > 768) {
    // Control+K toggles, so press again only while the dialog is still closed.
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press('Control+K');
      await expect(dialog).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
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

/** Simon, 2026-11-26: the product is placed on the change as the replacement, so nothing is drawn by hand. */
test('working on a Use <product> option offers to retire the current system and create that product as its replacement', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'productreplaces');
  await seedStarterCapabilityMap(page, /^Electricity Network Operator$/);
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connection Quotations' });
  await goToModelHome(page);

  await openSearch(page);
  await page.getByLabel('Search elements, changes, decisions and projects').fill('Connection Quotations');
  await page.getByRole('option', { name: /Connection Quotations/ }).first().click();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a decision…' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-outcome')).toBeVisible();

  // The products list appears once the decision has a Buy option.
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByRole('radio', { name: 'Buy a product', exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Buy a quoting product');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(optionSurface(page, 'Buy a quoting product')).toBeVisible();
  const product = page.getByTestId('capability-products').getByRole('listitem').filter({ hasText: 'Salesforce Energy and Utilities Cloud' }).first();
  await product.getByRole('button', { name: 'Make it an option' }).click();
  await expect(product.getByText('Added a new option: Use Salesforce Energy and Utilities Cloud.')).toBeVisible();
  await optionSurface(page, 'Use Salesforce Energy and Utilities Cloud').getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  const draftLink = page.getByRole('link', { name: "Draft this option's changes" });
  if (await draftLink.count() > 0) await draftLink.click();

  const card = page.getByTestId('option-draft-card');
  const link = card.getByRole('link', { name: 'Retire Legacy Quote Tool and replace it with Salesforce Energy and Utilities Cloud' });
  await expect(link).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await link.click();
  await expect(page).toHaveURL(/action=retire/);
  // The panel first looks for the product among what is already modelled; none matches, so create it, with the name filled in.
  await page.getByRole('button', { name: 'Create new instead' }).click();
  await expect(page.getByLabel('New system name')).toHaveValue('Salesforce Energy and Utilities Cloud');
  await expect(page.getByLabel('Planned end', { exact: true })).toBeVisible();
});

/** Simon, 2026-11-26: the replacement might be a product that is not on the list, entered by hand. */
test('a different product can be typed on the change and the Retire panel opens with that name', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'productmanual');
  await seedStarterCapabilityMap(page, /^Electricity Network Operator$/);
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connection Quotations' });
  await goToModelHome(page);
  await openSearch(page);
  await page.getByLabel('Search elements, changes, decisions and projects').fill('Connection Quotations');
  await page.getByRole('option', { name: /Connection Quotations/ }).first().click();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a decision…' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-outcome')).toBeVisible();
  // A Buy option with no listed product behind it: the product is entered by hand on the change.
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByRole('radio', { name: 'Buy a product', exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Replace with a product');
  await page.getByRole('button', { name: 'Add option' }).click();
  await optionSurface(page, 'Replace with a product').getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  const draftLink = page.getByRole('link', { name: "Draft this option's changes" });
  if (await draftLink.count() > 0) await draftLink.click();

  const card = page.getByTestId('option-draft-card');
  await expect(card.getByRole('link', { name: 'Retire Legacy Quote Tool and replace it with a new system' })).toBeVisible();
  await card.getByLabel(/Product that replaces it/).fill('Acme Quoting Suite');
  const link = card.getByRole('link', { name: 'Retire Legacy Quote Tool and replace it with Acme Quoting Suite' });
  await expect(link).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  await link.click();
  await page.getByRole('button', { name: 'Create new instead' }).click();
  await expect(page.getByLabel('New system name')).toHaveValue('Acme Quoting Suite');
});

/** Simon, 2026-11-26: the product may already be in the model as a module of a platform; use that element. */
test('a product that is already a module of a platform is found and chosen as the replacement, not created again', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'productmodule');
  await seedStarterCapabilityMap(page, /^Electricity Network Operator$/);
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Esri ArcGIS Platform', description: 'The Esri GIS platform.' });
  await goToModelHome(page);
  await addContainerFromHome(page, 'Utility Network', 'Esri ArcGIS Platform');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Microsoft Platform', description: 'The Microsoft business platform.' });
  await goToModelHome(page);
  await addContainerFromHome(page, 'Dynamics 365 Customer Service', 'Microsoft Platform');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connection Quotations' });
  await goToModelHome(page);
  await openSearch(page);
  await page.getByLabel('Search elements, changes, decisions and projects').fill('Connection Quotations');
  await page.getByRole('option', { name: /Connection Quotations/ }).first().click();
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('link', { name: 'Start a decision…' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByTestId('decision-outcome')).toBeVisible();
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByRole('radio', { name: 'Buy a product', exact: true }).check();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Replace with a product');
  await page.getByRole('button', { name: 'Add option' }).click();

  // The products list says which listed product is already in the model, and links to it.
  const dynamics = page.getByTestId('capability-products').getByRole('listitem').filter({ hasText: 'Microsoft Dynamics 365 Customer Service' }).first();
  await expect(dynamics.getByTestId('product-in-model')).toContainText('Dynamics 365 Customer Service, a module of Microsoft Platform');
  await expect(dynamics.getByTestId('product-in-model').getByRole('link')).toHaveAttribute('href', /\/e\//);
  const salesforce = page.getByTestId('capability-products').getByRole('listitem').filter({ hasText: 'Salesforce Energy and Utilities Cloud' }).first();
  await expect(salesforce).toBeVisible();
  await expect(salesforce.getByTestId('product-in-model')).toHaveCount(0);

  // The saved product on an option says so too.
  await dynamics.getByRole('button', { name: 'Make it an option' }).click();
  const grid = page.getByTestId('decision-criteria-grid');
  if ((page.viewportSize()?.width ?? 1280) < 700) await grid.getByText('Details and evidence').last().click();
  await grid.getByRole('button', { name: 'Sources (1)' }).first().click();
  await expect(grid.getByTestId('option-sources').getByTestId('product-in-model').first()).toContainText('a module of Microsoft Platform');
  // A product already in the model is a Use option, not a Buy; the person can still change it.
  await expect(grid.getByRole('combobox', { name: /Dynamics 365 Customer Service/ })).toHaveValue('use');

  await optionSurface(page, 'Replace with a product').getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  const draftLink = page.getByRole('link', { name: "Draft this option's changes" });
  if (await draftLink.count() > 0) await draftLink.click();

  const card = page.getByTestId('option-draft-card');
  await card.getByLabel(/Product that replaces it/).fill('Esri ArcGIS Utility Network');
  await card.getByRole('link', { name: 'Retire Legacy Quote Tool and replace it with Esri ArcGIS Utility Network' }).click();
  // The existing module is offered straight away, though the product's name is longer than the module's.
  const module = page.getByRole('button', { name: /Utility Network/ });
  await expect(module.first()).toBeVisible();
  await module.first().click();
  await expect(page.getByText(/Replaced by/)).toBeVisible();
  await expect(page.getByLabel('New system name')).toHaveCount(0);
});
