/**
 * F10 (ADR-024 §6.3) golden path, click-only from Home at 1280 and 390:
 * a change made inside a project retires a system; the roadmap's
 * "By project" grouping shows that system under the project, and a
 * system retired straight on main under "No project".
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, retireElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('roadmap grouped by project: the project\'s change lands under the project, other work under "No project"', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectroadmap');

  await addCapability(page, 'Customer Contact');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy CRM', description: 'The system the project retires.', capabilityName: 'Customer Contact' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'New CRM Platform', description: 'Its replacement.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Old Billing', description: 'Retired outside any project.' });
  // Retired straight on main — work that belongs to no project.
  await retireElement(page, isoDateDaysFromNow(60));
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible();

  // The project, then a record change started inside it.
  await goToModelHome(page);
  await clickNavItem(page, 'Projects');
  await page.getByLabel('Project title').fill('CRM replacement');
  await page.getByLabel('Owner').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: 'CRM replacement', level: 1 })).toBeVisible();

  await page.getByLabel('New change name').fill('sunset-legacy-crm');
  await page.getByLabel('New change intent').selectOption('record');
  await page.getByLabel('Delivered date').fill(isoDateDaysFromNow(120));
  await page.getByRole('button', { name: 'Start change' }).click();
  await expect(page.getByRole('link', { name: 'CRM replacement' })).toBeVisible();
  // "Start change" opens the new change already selected as the editing ref.
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();

  // Inside the change: retire Legacy CRM, replaced by New CRM Platform.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Legacy CRM');
  // Inside the search results: My work's Recent activity can also link
  // "Legacy CRM" once it has loaded, which made an unscoped click
  // ambiguous depending on timing.
  await page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: 'Legacy CRM' }).click();
  await expect(page.getByRole('heading', { name: 'Legacy CRM' })).toBeVisible();
  await retireElement(page, isoDateDaysFromNow(90), 'New CRM Platform');
  await expect(page.getByText(/Replaced by/)).toBeVisible();

  // Submit and merge (record: one approver, from the change's own request page).
  await clickNavItem(page, 'Projects');
  await page.getByRole('link', { name: 'Open CRM replacement' }).click();
  await page.getByRole('region', { name: 'Chosen design' }).getByRole('link', { name: 'sunset-legacy-crm' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  // The change and its review request each carry a "proposed" chip once submitted.
  await expect(page.getByText('proposed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // Roadmap, by project.
  await goToModelHome(page);
  await clickNavItem(page, 'Roadmap');
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'By project' }).click();
  await expect(page.getByRole('button', { name: 'By project' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/groupBy=project/);
  const groupsList = page.getByRole('list', { name: 'Projects' });
  await expect(groupsList).toBeVisible();
  await expect(page.getByRole('list', { name: 'CRM replacement systems' }).getByRole('link', { name: 'Legacy CRM' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'No project systems' }).getByRole('link', { name: 'Old Billing' })).toBeVisible();
  // The group header links to the project's own page.
  await groupsList.getByRole('link', { name: 'CRM replacement' }).click();
  await expect(page.getByRole('heading', { name: 'CRM replacement', level: 1 })).toBeVisible();
});
