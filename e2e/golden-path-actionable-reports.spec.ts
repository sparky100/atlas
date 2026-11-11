import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

async function createReport(page: Page, name: string) {
  await goToModelHome(page);
  await clickNavItem(page, 'Reports');
  await page.getByRole('button', { name: 'New relationship or finding report…' }).click();
  await page.getByLabel('Start with').selectOption({ label: name });
  await page.getByRole('button', { name: 'Create report', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('open a relationship and affected application from reports', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'actionable-reports');
  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger', description: 'Tracks accounts.', capabilityName: 'Finance' });

  await createReport(page, 'Capability support');
  const support = page.getByRole('row').filter({ hasText: 'Ledger' }).getByRole('link', { name: 'Supports', exact: true });
  await expect(support).toHaveAttribute('href', /\?ref=main#relationship-/);
  await support.click();
  await expect(page.getByRole('heading', { name: 'Ledger', exact: true })).toBeVisible();
  await expect(page.locator('[id^="relationship-"]:focus')).toContainText('Finance');

  await createReport(page, 'Current model findings');
  const finding = page.getByRole('row').filter({ hasText: 'Systems with no technical owner' });
  await finding.getByRole('link', { name: 'Ledger', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ledger', exact: true })).toBeVisible();
});
