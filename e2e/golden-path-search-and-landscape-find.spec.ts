/**
 * Two ways of finding a thing, click-only from Home like every golden path:
 *
 * 1. The search-anywhere dialog finds a container by what is on screen —
 *    "SAP FI", the platform and module together — not only by the module's
 *    own short name ("FI"), which many platforms share.
 * 2. "Find on this landscape": typing part of a system's name and picking it
 *    focuses that tile (the same focus a click gives, so its details open).
 */
import { expect, test, type Page } from '@playwright/test';
import { addContainerFromHome, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

/** Open the search dialog the way a user at this width would: the shortcut on a desktop, the nav's Search button (behind More) on a phone. */
async function openSearch(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  if ((page.viewportSize()?.width ?? 1280) > 768) {
    await page.keyboard.press('Control+K');
  } else {
    await nav.getByRole('button', { name: /^More/ }).click();
    await nav.getByRole('region', { name: 'More sections' }).getByRole('button', { name: 'Search' }).click();
  }
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
}

test('search anywhere finds a module by platform and name, and the landscape can find a system on itself', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-searchfind');
  await addSystemFromHome(page, { name: 'SAP', description: 'The enterprise resource planning platform.' });
  await goToModelHome(page);
  await addContainerFromHome(page, 'FI', 'SAP');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger System', description: 'The financial ledger system.' });

  // 1. Search anywhere, by the platform and module together — the module's own name is just "FI", which many platforms share.
  await goToModelHome(page);
  await openSearch(page);
  await page.getByLabel('Search elements, changes and decisions').fill('SAP FI');
  const moduleOption = page.getByRole('option', { name: /\bFI\b/ });
  await expect(moduleOption).toBeVisible();
  await moduleOption.click();
  await expect(page.getByRole('heading', { name: 'FI', exact: true })).toBeVisible();

  // 2. Find a system on the landscape itself.
  await goToModelHome(page);
  await clickNavItem(page, 'Landscape');
  await expect(page.getByRole('heading', { name: 'Landscape' })).toBeVisible();
  const find = page.getByRole('combobox', { name: 'Find on this landscape' });
  await expect(find).toBeVisible();
  await find.fill('Ledg');
  const match = page.getByRole('option', { name: /Ledger System/ });
  await expect(match).toBeVisible();
  await match.click();
  // Desktop: the tile is focused, so the details panel offers to clear it. Mobile: the list opens the group and shows the row.
  await expect(page.getByRole('button', { name: 'Clear', exact: true }).or(page.getByRole('link', { name: /Ledger System/ }))).toBeVisible();
  await expect(find).toHaveValue('');
});
