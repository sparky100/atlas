/**
 * Home's "My work" card (Simon, 2026-11-19), click-only from Home at 1280 and
 * 390: a project with a decision and an option change is listed once, as the
 * project, and a bare option title such as "Build Repairs Hub" is never listed
 * as a change of its own. A change with no project or decision is the only
 * kind that stands alone.
 */
import { expect, test } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('My work lists the project, not the decision options inside it', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'homemywork');
  await addCapability(page, 'Housing Repairs');
  await goToModelHome(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Start a project →' }).click();
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByTestId('start-project-decision')).toBeVisible();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Build Repairs Hub');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Build Repairs Hub').first()).toBeVisible();
  // A candidate becomes a change only when someone works on it; this test is
  // about the project → decision → change hierarchy.
  await page.getByRole('button', { name: 'Work on this option' }).first().click();
  await expect(page).toHaveURL(/\/changes\//);

  await goToModelHome(page);
  // The visit to Overview above is remembered, so switch back to My work.
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  // The project is listed once, under My projects; its decision and option are not listed again on their own.
  const projects = page.getByRole('list', { name: 'My projects' });
  await expect(projects.getByRole('link', { name: 'Who supports Housing Repairs' })).toHaveCount(1);
  // The hierarchy is project, decision, change: the decision sits inside the project and its option inside the decision.
  const inside = projects.getByRole('list', { name: 'Inside this project' });
  await expect(inside.getByRole('link', { name: 'How should we meet Housing Repairs?' })).toHaveCount(1);
  await expect(inside.getByRole('list', { name: 'Options' }).getByRole('link', { name: 'Build Repairs Hub' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Build Repairs Hub' })).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'My decisions' })).toHaveCount(0);
  // Projects come before decisions on the page.
  const order = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(order.indexOf('My projects')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('My projects')).toBeLessThan(order.indexOf('My decisions'));

  // The Work overview lists the same open items: the project, not its decision or option.
  await clickNavItem(page, 'Work');
  await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();
  const projectsCard = page.getByTestId('work-card-projects');
  await expect(projectsCard.getByRole('link', { name: 'Who supports Housing Repairs' })).toBeVisible();
  await expect(page.getByTestId('work-card-decisions').getByRole('link', { name: 'How should we meet Housing Repairs?' })).toHaveCount(0);
  await expect(page.getByTestId('work-card-changes').getByRole('link', { name: 'Build Repairs Hub' })).toHaveCount(0);

  // The Changes list nests the option under its decision, under the project: nothing stands alone.
  await clickNavItem(page, 'Changes');
  const inProjects = page.getByTestId('changes-in-projects');
  await expect(inProjects.getByRole('link', { name: 'Who supports Housing Repairs' })).toBeVisible();
  await expect(inProjects.getByRole('link', { name: 'How should we meet Housing Repairs?' })).toBeVisible();
  await expect(inProjects.getByText('Build Repairs Hub')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Propose/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Explore/ })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
