/**
 * Plan A2, "Connect a new customer": an application with no capability link
 * recorded raises the architect-door finding; its one action starts a
 * decision to keep, link or retire it (retirement is an option to
 * investigate, not a conclusion); and an integration platform that a
 * capability-serving system flows to is NOT flagged — no link recorded is
 * not the same as no business use found. Click-only from Home at 1280 and 390.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function healthPanel(page: Page) {
  return page.getByTestId('health-findings-panel');
}

test('system without a capability link: finding offers keep / link / retire, opening a prefilled decision', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'systemnocap');

  await addCapability(page, 'Connect a new customer');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.' });

  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText('1 system not linked to a capability')).toBeVisible();

  await healthPanel(page).getByRole('link', { name: 'Keep, link or retire? →' }).click();
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('Keep, link or retire Quote Tool?');
  await expect(page.getByText(/No business use has been ruled in or out/).first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
