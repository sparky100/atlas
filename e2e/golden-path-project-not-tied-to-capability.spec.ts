/**
 * Plan A1b (Simon's rule, 2026-11-18: "a project can't be independent of a
 * capability"), click-only from Home at 1280 and 390 (S2's own rule): a
 * project whose scope loses its only capability raises the architect-door
 * "Project not tied to a capability" finding; opening the project from the
 * finding offers the capability its scoped system supports, and adding it in
 * one click clears the finding.
 *
 * A1a already stops a project starting with no capability, so the gap is
 * reached here the one way it still can — a capability removed from an
 * existing project's scope (the DB guarantee that refuses that removal is a
 * later, optional migration, not part of A1b).
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, addSystemFromHome, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const SUMMARY = /not tied to a capability/;

function healthPanel(page: Page) {
  return page.getByTestId('health-findings-panel');
}

test('project not tied to a capability: finding appears, one-click add from the derived capability clears it', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectnocap');

  // A capability and a system that supports it.
  await addCapability(page, 'Employee Pay');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'HR System', description: 'Supports pay.', capabilityName: 'Employee Pay' });

  // 1. Start a project naming both the capability (A1a) and the system.
  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();
  await page.getByLabel('Project title').fill('Pay platform refresh');
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByPlaceholder(/Search a capability this project serves/).fill('Employee Pay');
  await page.getByRole('button', { name: 'Employee Pay' }).click();
  await expect(page.getByRole('button', { name: 'Remove Employee Pay' })).toBeVisible();
  await page.getByPlaceholder(/Search a capability this project serves/).fill('HR System');
  await page.getByRole('button', { name: 'HR System' }).click();
  await expect(page.getByRole('button', { name: 'Remove HR System' })).toBeVisible();
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: 'Pay platform refresh', level: 1 })).toBeVisible();

  // 2. Remove the capability from the project's scope — the system stays.
  await page.getByRole('button', { name: 'Remove Employee Pay from scope' }).click();
  await expect(page.getByRole('button', { name: 'Remove Employee Pay from scope' })).toHaveCount(0);
  // The project page now says it names no capability, offering the derived one.
  await expect(page.getByText('This project names no capability', { exact: false })).toBeVisible();

  // 3. Home raises the finding, naming the project.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText(SUMMARY)).toBeVisible();
  await expect(healthPanel(page).getByText('Pay platform refresh').first()).toBeVisible();

  // 4. Open the project from the finding's own action.
  await healthPanel(page).getByRole('link', { name: 'Open Pay platform refresh →' }).click();
  await expect(page.getByRole('heading', { name: 'Pay platform refresh', level: 1 })).toBeVisible();

  // 5. One click adds the capability the scoped system supports.
  await page.getByRole('button', { name: 'Add Employee Pay to scope' }).click();
  await expect(page.getByRole('button', { name: 'Remove Employee Pay from scope' })).toBeVisible();
  await expect(page.getByText('This project names no capability', { exact: false })).toHaveCount(0);

  // 6. The finding clears on Home.
  await goToModelHome(page);
  await expect(healthPanel(page).getByText('Loading…')).toHaveCount(0);
  await expect(healthPanel(page).getByText(SUMMARY)).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
