/**
 * Plan A1 (Simon's rule, 2026-11-18: "a project can't be independent of a
 * capability"), click-only from Home at 1280 and 390 (S2's own rule): the
 * Start-a-project form refuses to start until at least one capability is
 * named. A blank form with only a title and an architect is blocked and
 * says why; naming a capability through the scope picker unblocks it.
 */
import { expect, test } from '@playwright/test';
import { addCapability, clickNavItem, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('a project must name a capability before it can be started', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'projectneedscap');

  // A capability to name — created on the map so the scope picker can find it.
  await addCapability(page, 'Housing Repairs');

  await clickNavItem(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible();

  // Fill the basics but name no capability yet.
  await page.getByLabel('Project title').fill('Repairs improvement');
  await page.getByLabel('Architect').selectOption({ index: 1 });

  // The guard: the form explains the rule and "Start project" is disabled.
  await expect(page.getByText('Name at least one capability this project serves', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start project' })).toBeDisabled();

  // Name the capability through the scope picker.
  await page.getByPlaceholder(/Search a capability this project serves/).fill('Housing');
  await page.getByRole('button', { name: 'Housing Repairs' }).click();
  await expect(page.getByRole('button', { name: 'Remove Housing Repairs' })).toBeVisible();

  // Now the rule is satisfied: the hint is gone and the form can be started.
  await expect(page.getByText('Name at least one capability this project serves', { exact: false })).toHaveCount(0);
  const start = page.getByRole('button', { name: 'Start project' });
  await expect(start).toBeEnabled();
  await start.click();

  await expect(page.getByRole('heading', { name: 'Repairs improvement', level: 1 })).toBeVisible();

  // No horizontal overflow (meaningful at 390).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
