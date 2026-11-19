/**
 * Decision-side-completion item 7b(a): two like-for-like options — neither
 * has a single commit of its own — show the What-changes table's own
 * empty-state sentence (nothing differs, not even the model-wide boundary-
 * crossings row) and each option's own header reads "No changes recorded
 * yet" (decision 3 in the sprint's own go-ahead: `optionSummaries` is
 * `null` for an empty-delta option, never an empty string). Click-only
 * from Home (S2's own rule) — no concern is linked and no option is ever
 * edited, so nothing here needs a system, a capability, or a branch edit.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('two like-for-like options with no commits of their own show the empty-state sentence and "No changes recorded yet" on each', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisionempty');

  await clickNavItem(page, 'Decisions');
  const decisionTitle = `Which vendor for the new ledger? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('Two vendors are shortlisted; neither has been explored yet.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // Every new decision starts with its "Stay as we are" baseline: described (two plain questions), not scored.
  const baseline = page.getByRole('region', { name: 'Stay as we are' });
  await expect(baseline).toBeVisible();
  await expect(baseline.getByText('Describe it; it is not scored.')).toBeVisible();
  await baseline.getByLabel('What is the operational risk of staying as we are?').fill('The vendor ends support in March.');
  await baseline.getByRole('button', { name: 'Save baseline' }).click();
  await expect(baseline.getByRole('button', { name: 'Save baseline' })).toBeDisabled();

  const optionSpecs: [string, string][] = [
    ['vendor-a', 'Vendor A'],
    ['vendor-b', 'Vendor B'],
  ];
  for (const [, title] of optionSpecs) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }

  // Neither option has a commit of its own — each header reads the same
  // muted placeholder, never a blank cell or a fabricated summary.
  await expect(page.getByText('No changes recorded yet')).toHaveCount(2);

  // Each option says it is a change and offers the way in to edit it.
  const grid = page.getByTestId('decision-criteria-grid');
  await expect(grid.getByText('A change', { exact: true })).toHaveCount(2);
  await expect(grid.getByRole('button', { name: 'Edit this change' })).toHaveCount(2);
  await expect(grid.getByText('Use Edit this change to draft it.')).toHaveCount(2);

  // The What-changes table itself: with nothing declared as a concern and
  // nothing changed on either option (not even the always-present
  // boundary-crossings row), every row collapses and the table's own
  // empty-state sentence shows instead of an empty table.
  await expect(page.getByText("These options don't change the structure of anything in scope.")).toBeVisible();

  // Item 10 (sticky column, phone width): at a narrow viewport, the
  // criteria grid's own two option-header columns (`DecisionCriteriaGrid.module.css`'s
  // `.tableWrap`) must never widen the *page* itself — its own
  // `overflow-x: auto` absorbs any width the columns need, the same
  // established check every other narrow-viewport spec in this directory
  // uses (`element-browse-sticky-header.engine.spec.ts`).
  await page.setViewportSize({ width: 380, height: 800 });
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
