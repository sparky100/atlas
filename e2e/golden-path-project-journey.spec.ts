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
  // Before and after, per capability: what supports it today, and no change to compare yet.
  const beforeAfter = page.getByTestId('project-before-after');
  await expect(beforeAfter.getByRole('heading', { name: 'What this changes, capability by capability' })).toBeVisible();
  // The project names no system, so Quote Tool is shown apart as sharing the capability, not as part of the project.
  await expect(beforeAfter.getByText('No system is named in this project yet.')).toBeVisible();
  await beforeAfter.getByTestId('also-supports').getByText('Also supports this capability, not in this project (1)').click();
  await expect(beforeAfter.getByRole('link', { name: 'Quote Tool', exact: true })).toBeVisible();
  await expect(beforeAfter.getByText('No change has been drafted yet', { exact: false })).toBeVisible();

  // The same facts as a connected picture: capability, supporting systems, connected apps.
  await beforeAfter.getByRole('button', { name: 'Diagram' }).click();
  const diagram = beforeAfter.getByTestId('project-diagram').first();
  await expect(diagram).toBeVisible();
  // Quote Tool shares the capability but the project does not name it, so it is not drawn, and the picture says so.
  await expect(diagram.getByRole('link', { name: 'Quote Tool', exact: true })).toHaveCount(0);
  await expect(beforeAfter.getByTestId('diagram-also-supports').first()).toContainText('Quote Tool');
  await beforeAfter.getByRole('button', { name: 'List' }).click();
  await expect(beforeAfter.getByTestId('project-diagram')).toHaveCount(0);

  // Nothing we run supports this one: said plainly, not an error.
  await goToModelHome(page);
  await startProject(page, 'Fault response', 'Respond to supply faults faster.', 'Handle a fault');
    await expect(page.getByTestId('project-before-after').getByText('Nothing we run supports this. A buy or build option is needed.')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
