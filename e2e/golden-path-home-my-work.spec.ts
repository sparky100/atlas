/**
 * Home's "My work" card (Simon, 2026-11-19), click-only from Home at 1280 and
 * 390: a project with a decision and an option change is listed once, as the
 * project, and a bare option title such as "Build Repairs Hub" is never listed
 * as a change of its own. A change with no project or decision is the only
 * kind that stands alone.
 */
import { expect, test } from '@playwright/test';
import { addCapability, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('My work lists the project, not the decision options inside it', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'homemywork');
  await addCapability(page, 'Housing Repairs');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByTestId('project-next-step')).toBeVisible();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Build Repairs Hub');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Build Repairs Hub').first()).toBeVisible();

  await goToModelHome(page);
  // The visit to Overview above is remembered, so switch back to My work.
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  const list = page.getByTestId('my-work-list');
  await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Who supports Housing Repairs' })).toBeVisible();
  await expect(list.getByText('Project · ')).toBeVisible();
  await expect(list.getByRole('link', { name: 'Build Repairs Hub' })).toHaveCount(0);
  await expect(list.getByRole('link', { name: 'Stay as we are' })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
