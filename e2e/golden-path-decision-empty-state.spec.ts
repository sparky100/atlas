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
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('two like-for-like options with no commits of their own show the empty-state sentence and "No changes recorded yet" on each', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisionempty');

  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionTitle = `Which vendor for the new ledger? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('Two vendors are shortlisted; neither has been explored yet.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const optionSpecs: [string, string][] = [
    ['vendor-a', 'Vendor A'],
    ['vendor-b', 'Vendor B'],
  ];
  for (const [name, title] of optionSpecs) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill(name);
    await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }

  // Neither option has a commit of its own — each header reads the same
  // muted placeholder, never a blank cell or a fabricated summary.
  await expect(page.getByText('No changes recorded yet')).toHaveCount(2);

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
