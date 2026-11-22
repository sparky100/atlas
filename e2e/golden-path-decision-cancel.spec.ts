/**
 * Cancel a decision (ADR-022 amendment, 2026-10-03) — click-only from Home,
 * at 1280 and 390. A project with an open decision can't be closed; the
 * decision, with one draft option, is cancelled with a reason; it then
 * reads as cancelled (who, when, why), its option is cancelled with it,
 * and the project closes.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCapability, clickNavItem, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

const PROJECT = 'Replace BW';
const DECISION = 'What to replace BW with';

/** The Decisions count: on the rail at 1280; at 390 Decisions is behind More, which carries a dot (and says so to a screen reader) instead. */
async function expectProposedDecisions(page: Page, count: number): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  const more = nav.getByRole('button', { name: /^More/ });
  if (await more.isVisible()) {
    if (count > 0) await expect(more).toHaveAccessibleName(/decisions proposed/);
    else await expect(more).not.toHaveAccessibleName(/decisions proposed/);
  } else if (count > 0) {
    await expect(nav.getByRole('link', { name: `Decisions (${String(count)} proposed)` })).toBeVisible();
  } else {
    await expect(nav.getByRole('link', { name: 'Decisions', exact: true })).toBeVisible();
  }
}

async function openProject(page: Page): Promise<void> {
  await goToModelHome(page);
  await clickNavItem(page, 'Projects');
  await page.getByRole('link', { name: `Open ${PROJECT}` }).click();
  await expect(page.getByRole('heading', { name: PROJECT, level: 1 })).toBeVisible();
}

test('cancel a decision: it stays in the log as cancelled with its reason, its draft option is cancelled, and its project can close', async ({ page }) => {
  test.slow();
  await signUpCreateOrgAndModel(page, 'decisioncancel');
  // Plan A1: a project must name a capability — create one to name.
  await addCapability(page, 'Reporting');

  await clickNavItem(page, 'Projects');
  await page.getByLabel('Project title').fill(PROJECT);
  await page.getByLabel('Architect').selectOption({ index: 1 });
  await page.getByPlaceholder(/Search a capability this project serves/).fill('Reporting');
  await page.getByRole('button', { name: 'Reporting' }).click();
  await expect(page.getByRole('button', { name: 'Remove Reporting' })).toBeVisible();
  await page.getByRole('button', { name: 'Start project' }).click();
  await expect(page.getByRole('heading', { name: PROJECT, level: 1 })).toBeVisible();

  // A decision in the project, with one option.
  await page.getByLabel('New decision title').fill(DECISION);
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: DECISION })).toBeVisible();
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Move to Datasphere');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Move to Datasphere').first()).toBeVisible();

  // The open decision blocks closing the project, and the Decisions item counts it.
  await openProject(page);
  await expectProposedDecisions(page, 1);
  await page.getByText(/Why can.t this project close\?/).click();
  await expect(page.getByText('To close or cancel this project, first finish or cancel what is still open in it:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close project' })).toHaveCount(0);

  // Cancel the decision, with a reason.
  await page.getByRole('link', { name: DECISION }).first().click();
  await expect(page.getByRole('heading', { name: DECISION })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel decision…' }).click();
  await expect(page.getByRole('button', { name: 'Confirm cancel' })).toBeDisabled();
  await page.getByLabel('Why is this decision being cancelled?').fill('BW stays until the 2028 platform review.');
  await page.getByRole('button', { name: 'Confirm cancel' }).click();

  await expect(page.getByText('cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Cancelled by .+ on \d{4}-\d{2}-\d{2} — BW stays until the 2028 platform review\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel decision…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Add an option' })).toHaveCount(0);

  // Cancelled: no longer counted. The project now lists nothing open and can close; its option is closed without merging.
  await expectProposedDecisions(page, 0);
  await openProject(page);
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Move to Datasphere' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close project' }).click();
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});
