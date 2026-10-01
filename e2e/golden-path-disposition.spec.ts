/**
 * F11 (ADR-001 "Amended (Disposition, TIME)") golden path, click-only from
 * Home at 1280 and 390: mark a system Migrate → the "nothing retiring it"
 * finding appears → start a project from it → a change in that project
 * retires the system → the finding clears, and stays clear once merged.
 */
import { expect, test, type Page } from '@playwright/test';
import { addSystemFromHome, clickNavItem, goToModelHome, retireElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const SUMMARY = /marked Migrate or Eliminate with no open change retiring/;

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

  // 1. A system, marked Migrate through the ordinary Attributes editor.
  await addSystemFromHome(page, { name: 'Legacy Payroll', description: 'The payroll system being moved off.' });
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Disposition').selectOption('migrate');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Migrate', { exact: true }).first()).toBeVisible();

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
  await expect(page.getByLabel('Project title')).toHaveValue('Migrate Legacy Payroll');
  await expect(page.getByRole('button', { name: 'Remove Legacy Payroll' })).toBeVisible();
  await page.getByLabel('Owner').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: 'Migrate Legacy Payroll', level: 1 })).toBeVisible();

  // While nothing retires it, the finding stays — now pointing at the project.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText(/Legacy Payroll \(project: Migrate Legacy Payroll\)/)).toBeVisible();
  await healthPanel(page).getByRole('link', { name: 'Open Migrate Legacy Payroll →' }).click();
  await expect(page.getByRole('heading', { name: 'Migrate Legacy Payroll', level: 1 })).toBeVisible();

  // 4. A record change inside the project retires the system.
  await page.getByLabel('New change name').fill('retire-legacy-payroll');
  await page.getByLabel('New change intent').selectOption('record');
  await page.getByLabel('Delivered date').fill(isoDateDaysFromNow(120));
  await page.getByRole('button', { name: 'Start change' }).click();
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();

  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Legacy Payroll');
  await page.getByRole('link', { name: 'Legacy Payroll' }).click();
  await expect(page.getByRole('heading', { name: 'Legacy Payroll' })).toBeVisible();
  await retireElement(page, isoDateDaysFromNow(90));
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible();

  // 5. An open change now retires it: the finding clears.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText(SUMMARY)).toHaveCount(0);

  // 6. Submit and merge (record: one approver); the finding stays clear on main.
  await clickNavItem(page, 'Projects');
  await page.getByRole('link', { name: 'Open Migrate Legacy Payroll' }).click();
  await page.getByRole('region', { name: 'Chosen design' }).getByRole('link', { name: 'retire-legacy-payroll' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('proposed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText(SUMMARY)).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
