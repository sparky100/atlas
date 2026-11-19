/**
 * Plan B1, "Connect a new customer": a project page shows the journey from
 * need to choice. The estate query says what we already run that supports
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

test('project journey: requirement, what it touches, how it might be met from the estate, choosing', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectjourney');

  await addCapability(page, 'Connect a new customer');
  await addCapability(page, 'Handle a fault');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Quote Tool', description: 'Issues connection quotes.', capabilityName: 'Connect a new customer' });

  // Something we run already supports the capability.
  await goToModelHome(page);
  await startProject(page, 'Faster connection quotes', 'Cut the time to issue a connection quote.', 'Connect a new customer');
  const journey = page.getByRole('list', { name: 'Project journey' });
  await expect(journey.getByText('Cut the time to issue a connection quote.')).toBeVisible();
  await expect(journey.getByText('1 capability in scope, no change drafted yet.')).toBeVisible();
  await expect(journey.getByText('Every capability is already supported by something we run (1).')).toBeVisible();
  await expect(journey.getByText('No decision started yet.')).toBeVisible();
  // The first step not done reads "Next", in words.
  await expect(journey.getByText('Next', { exact: true })).toBeVisible();

  // Nothing we run supports this one: said plainly, not an error.
  await goToModelHome(page);
  await startProject(page, 'Fault response', 'Respond to supply faults faster.', 'Handle a fault');
  await expect(page.getByRole('list', { name: 'Project journey' }).getByText('Nothing we run supports Handle a fault — a buy or build option is needed.')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
