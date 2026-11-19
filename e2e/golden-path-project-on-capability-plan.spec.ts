/**
 * Plan A3, "Connect a new customer": a project to reduce the time to issue
 * a connection quote shows as a bar on the Roadmap's "By capability" view,
 * on the capability it serves; a project with no dates is listed beneath the
 * plan rather than hidden. Click-only from Home at 1280 and 390.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function startProject(page: Page, title: string, capability: string, dates: { start?: string; target?: string }): Promise<void> {
  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await page.getByLabel('Project title').fill(title);
  await page.getByLabel('Architect').selectOption({ index: 1 });
  if (dates.start) await page.getByLabel('Start date').fill(dates.start);
  if (dates.target) await page.getByLabel('Target date').fill(dates.target);
  await page.getByPlaceholder(/Search a capability this project serves/).fill(capability);
  await page.getByRole('button', { name: capability }).click();
  await expect(page.getByRole('button', { name: `Remove ${capability}` })).toBeVisible();
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

test('a project shows on its capability in the Roadmap plan; an undated one is listed beneath it', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectplan');
  await addCapability(page, 'Connect a new customer');

  await goToModelHome(page);
  await startProject(page, 'Faster connection quotes', 'Connect a new customer', { start: isoDateDaysFromNow(10), target: isoDateDaysFromNow(150) });
  await goToModelHome(page);
  await startProject(page, 'Quote policy review', 'Connect a new customer', {});

  await goToModelHome(page);
  await clickNavItem(page, 'Roadmap');
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();

  // By capability is the default grouping: the dated project sits on its capability.
  await expect(page.getByRole('button', { name: 'By capability' })).toHaveAttribute('aria-pressed', 'true');
  const plan = page.getByRole('list', { name: 'Capability domains' });
  await expect(plan.getByRole('list', { name: 'Connect a new customer projects' }).getByRole('link', { name: 'Faster connection quotes' })).toBeVisible();

  // The undated one is not hidden: it is listed beneath, saying what it needs.
  const unplaced = page.getByTestId('roadmap-unplaced-projects');
  await expect(unplaced.getByRole('link', { name: 'Quote policy review' })).toBeVisible();
  await expect(unplaced.getByText('needs a start or target date')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
