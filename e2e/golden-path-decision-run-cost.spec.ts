/**
 * Decision page "What changes": the Run cost row — click-only from Home
 * (S2's own rule), same shape as `golden-path-decision-replace-pm.spec.ts`
 * (a real "Retire… with a replacement picked" option, ADR-000/ADR-001),
 * extended to set Run cost on both the retiring system (on main, before
 * the option forks) and its replacement (on the option, where it's
 * created) — the row must pair them: "PM £250k–£1m → Hana equivalent
 * £50k–£250k". Runs at both 1280 and 390 like every `golden-path-*` spec;
 * the 390 run is this spec's own "phone width usable" check.
 */
import { randomUUID } from 'node:crypto';
import { compactDecision, changesSurface, optionSurface } from './fixtures/decisionLayout';
import { expect, test, type Page } from '@playwright/test';
import { addSystemFromHome, goToModelHome, retireElement, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

async function setRunCost(page: Page, band: string): Promise<void> {
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Run cost').selectOption(band);
  await page.getByRole('button', { name: 'Save' }).click();
}

test('replacing a costed system with a costed alternative on an option shows the paired bands in the Run cost row', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisionruncost');

  // PM, on main — costed before the option ever forks, so its band comes
  // from main at the option's own fork point, per the task's own rule.
  await addSystemFromHome(page, { name: 'PM', description: 'The system to be replaced.' });
  await setRunCost(page, '250k_1m');

  // Start the decision, linking PM as its one concern.
  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  const decisionTitle = `What replaces PM? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('PM is end of life; Hana equivalent is the named replacement.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('PM');
  await page.getByRole('button', { name: 'PM' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const optionTitle = 'Replace PM with Hana';
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(optionTitle);
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText(optionTitle).first()).toBeVisible();

  await optionSurface(page, optionTitle).getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  // An option leads with "Draft this option's changes", which opens the landscape on this option (it becomes the editing ref).
  await page.getByRole('link', { name: "Draft this option's changes" }).click();
  await expect(page).toHaveURL(/landscape/);

  // On the option's own branch: create and cost Hana equivalent, then
  // retire PM naming it as the real replacement.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Hana equivalent', description: 'The named replacement, added on this option.' });
  await setRunCost(page, '50k_250k');
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('PM');
  await page.getByRole('link', { name: 'PM', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'PM' })).toBeVisible();
  await retireElement(page, '2026-06-01', 'Hana equivalent');
  await expect(page.getByText(/Replaced by/)).toBeVisible();

  // Back on the decision: the Run cost row pairs the two, evidence only —
  // no total, no difference, no "saving" text anywhere in the row.
  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  const decisionRow = page.locator('li', { hasText: decisionTitle });
  await decisionRow.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const changes = changesSurface(page);
  await expect(changes).toBeVisible();
  if (compactDecision(page)) {
    await expect(changes.getByRole('article', { name: /Replace PM with Hana/ })).toContainText('PM £250k–£1m → Hana equivalent £50k–£250k');
  } else {
    const runCostRow = changes.locator('tr', { hasText: 'Run cost' });
    await expect(runCostRow).toContainText('PM £250k–£1m → Hana equivalent £50k–£250k');
    await expect(runCostRow).not.toContainText('saving');
    await expect(runCostRow).not.toContainText('total');
  }

  // Phone width usable: the row's own text is still reachable and the
  // page itself never grows a horizontal scrollbar.
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
