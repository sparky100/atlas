/**
 * Plan B1, "Connect a new customer": a project page shows, per capability, what
 * we already run that supports it. The estate query says what we already run that supports
 * the capability — and says plainly when nothing does. Click-only from Home
 * at 1280 and 390.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function startProject(page: Page, title: string, purpose: string, capability: string): Promise<void> {
  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await page.getByLabel('Project title').fill(title);
  await page.getByLabel('Purpose').fill(purpose);
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByPlaceholder(/Search a capability this project serves/).fill(capability);
  await page.getByRole('button', { name: capability }).click();
  await expect(page.getByRole('button', { name: `Remove ${capability}` })).toBeVisible();
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

test('project page: what supports each capability today, from the estate', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectjourney');

  await addCapability(page, 'Connect a new customer');
  await addCapability(page, 'Handle a fault');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connect a new customer' });

  // Something we run already supports the capability.
  await goToModelHome(page);
  await startProject(page, 'Faster connection quotes', 'Cut the time to issue a connection quote.', 'Connect a new customer');
  // Scope names the need and gives the existing estate signal without pretending there is a target design.
  await expect(page.getByRole('heading', { name: 'Scope', exact: true })).toBeVisible();
  await expect(page.getByText('Systems recorded today: Quote Tool')).toBeVisible();
  await expect(page.getByTestId('project-before-after')).toHaveCount(0);

  await goToModelHome(page);
  await startProject(page, 'Fault response', 'Respond to supply faults faster.', 'Handle a fault');
  await expect(page.getByText('No supporting system recorded; investigate what meets this need.')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
