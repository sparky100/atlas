/**
 * Phase B2 (Simon, 2026-11-19), click-only from Home at 1280 and 390: a
 * project can start as a proposal. It shows as Proposed, says it is not yet
 * work in hand, and an owner accepts it, after which it is Active.
 */
import { expect, test } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a project can be proposed and then accepted by an owner', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectproposed');
  await addCapability(page, 'Housing Repairs');

  await clickNavItem(page, 'Projects');
  await page.getByLabel('Project title').fill('Repairs improvement');
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByPlaceholder(/Search a capability this project serves/).fill('Housing');
  await page.getByRole('button', { name: 'Housing Repairs' }).click();
  await page.getByLabel(/Start as a proposal/).check();
  await page.getByRole('button', { name: 'Propose project' }).click();

  await expect(page.getByRole('heading', { name: 'Repairs improvement', level: 1 })).toBeVisible();
  await expect(page.getByText('This is a proposal.', { exact: false })).toBeVisible();
  await expect(page.getByText('Proposed', { exact: true }).first()).toBeVisible();

  // The proposal is not invisible: Home says it is waiting (this person is the only owner, so can accept their own).
  await goToModelHome(page);
  await expect(page.getByTestId('projects-waiting-for-you')).toContainText('1 project is waiting for you to accept it');
  await page.getByTestId('projects-waiting-for-you').getByRole('link').click();
  await page.getByRole('link', { name: 'Repairs improvement' }).first().click();

  await page.getByRole('button', { name: 'Accept proposal' }).click();
  await expect(page.getByText('This is a proposal.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Put on hold' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
