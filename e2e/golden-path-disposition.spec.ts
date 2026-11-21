/**
 * F11 (ADR-001 "Amended (Disposition, TIME)") golden path, click-only from
 * Home at 1280 and 390: mark a system Migrate → the "nothing retiring it"
 * finding appears → start a project from it → a change in that project
 * retires the system → the finding clears, and stays clear once merged.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, retireElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const SUMMARY = /planned to move or switch off with no open change retiring/;

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function healthPanel(page: Page) {
  return page.getByTestId('health-findings-panel');
}

test('disposition: Migrate raises a finding, a project retires the system, the finding clears', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'disposition');

  // 1. A system supporting a capability, marked Migrate through the ordinary Attributes editor.
  await addCapability(page, 'Employee Pay');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy Payroll', description: 'The payroll system being moved off.', capabilityName: 'Employee Pay' });
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Planned action').selectOption('migrate');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Move to another system', { exact: true }).first()).toBeVisible();

  // 2. Home shows the finding, naming the system.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText(SUMMARY)).toBeVisible();
  const card = healthPanel(page)
    .locator('div')
    .filter({ hasText: SUMMARY, has: page.getByRole('link', { name: 'Start a project →' }) })
    .last();
  await expect(card.getByText(/Legacy Payroll/)).toBeVisible();

  // 3. Start a project from it: the form opens already filled in.
  await card.getByRole('link', { name: 'Start a project →' }).click();
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await expect(page.getByLabel('Project title')).toHaveValue('Move Legacy Payroll to another system');
  await expect(page.getByRole('button', { name: 'Remove Legacy Payroll' })).toBeVisible();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  // Plan A1: a project must name a capability it serves — add the one the system supports.
  await page.getByPlaceholder(/Search a capability this project serves/).fill('Employee Pay');
  await page.getByRole('button', { name: 'Employee Pay' }).click();
  await expect(page.getByRole('button', { name: 'Remove Employee Pay' })).toBeVisible();
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: 'Move Legacy Payroll to another system', level: 1 })).toBeVisible();

  // While nothing retires it, the finding stays — now pointing at the project.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText(/Legacy Payroll \(project: Move Legacy Payroll to another system\)/)).toBeVisible();
  await healthPanel(page).getByRole('link', { name: 'Open Move Legacy Payroll to another system →' }).click();
  await expect(page.getByRole('heading', { name: 'Move Legacy Payroll to another system', level: 1 })).toBeVisible();

  // 4. A record change inside the project retires the system.
  await clickNavItem(page, 'Changes');
  const newChange = page.locator('form').filter({ has: page.getByLabel("What's this change?") });
  await newChange.getByLabel("What's this change?").fill('retire-legacy-payroll');
  await newChange.locator('select').selectOption('record');
  await newChange.locator('input[type="date"]').fill(isoDateDaysFromNow(120));
  await newChange.getByRole('button', { name: 'Create change' }).click();
  await page.getByRole('button', { name: 'Add to project…' }).click();
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Move Legacy Payroll to another system' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('change-parents').getByRole('link', { name: 'Move Legacy Payroll to another system' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();

  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Legacy Payroll');
  // Inside the search results: My work also links "Move Legacy Payroll to another system"
  // (My projects), which an unscoped name match would hit too.
  await page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: 'Legacy Payroll' }).click();
  await expect(page.getByRole('heading', { name: 'Legacy Payroll' })).toBeVisible();
  await retireElement(page, isoDateDaysFromNow(90));
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible();

  // 5. An open change now retires it: the finding clears.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText(SUMMARY)).toHaveCount(0);

  // 6. Submit and merge (record: one approver); the finding stays clear on main.
  await clickNavItem(page, 'Projects');
  await page.getByRole('link', { name: 'Open Move Legacy Payroll to another system' }).click();
  await page.getByRole('region', { name: 'Other project changes' }).getByRole('link', { name: 'retire-legacy-payroll' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  // The change and its review request each carry a "proposed" chip once submitted.
  await expect(page.getByText('proposed', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText(SUMMARY)).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
