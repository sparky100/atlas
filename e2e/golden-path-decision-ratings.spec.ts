/**
 * Decision criteria ratings (docs/prompts/atlas-prompt-pack.md's own
 * "add fixed decision criteria ratings" brief): rate some criteria on two
 * options, leave others unrated, confirm the progress cue and the
 * distinct "Not rated" state, choose one option with a rationale, confirm
 * the recorded ratings stay in place — and become read-only — after the
 * choice. Click-only from Home, same "no seeding beyond org and user" S2
 * rule every other `golden-path-*.spec.ts` follows; no capability concern
 * is seeded since the criteria grid only needs the decision's own linked
 * options, not the (separately-covered) structural comparison table.
 */
import { expect, test } from '@playwright/test';
import { signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('rate decision options on judgement criteria, leave some unrated, choose one with a rationale; ratings stay recorded and read-only afterwards', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'ratings');

  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionTitle = `Which replaces the ledger system? ${Date.now().toString()}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('The current ledger system is past its support end date.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // Two options.
  const optionSpecs: [string, string][] = [
    ['option-a', 'Option 1'],
    ['option-b', 'Option 2'],
  ];
  for (const [name, title] of optionSpecs) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill(name);
    await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }

  // The criteria grid renders once both options are linked; find which
  // header column belongs to which option (`decision_links` carries no
  // guaranteed order) rather than assuming insertion order.
  const criteriaTable = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Criterion' }) });
  await expect(criteriaTable).toBeVisible();
  const headers = await criteriaTable.locator('th').allTextContents();
  const optionAColumn = headers.findIndex((h) => h.includes('Option 1'));
  const optionBColumn = headers.findIndex((h) => h.includes('Option 2'));
  expect(optionAColumn).toBeGreaterThan(0);
  expect(optionBColumn).toBeGreaterThan(0);

  async function rateCell(criterionLabel: string, optionColumn: number, levelLabel: string, note: string) {
    const row = criteriaTable.locator('tr', { hasText: criterionLabel });
    await row.locator('button').nth(optionColumn - 1).click();
    const editor = page.getByTestId('decision-rating-editor');
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: levelLabel }).click();
    await editor.getByPlaceholder('A short reason for this rating').fill(note);
    await editor.getByRole('button', { name: 'Save rating' }).click();
    await expect(editor).toHaveCount(0);
  }

  // Option 1: rate Cost and Delivery risk, leave Effort/Timing/Vendor and strategic fit unrated (2 of 5).
  await rateCell('Cost', optionAColumn, 'Low', 'Cheaper than the incumbent.');
  await rateCell('Delivery risk', optionAColumn, 'Medium', 'Some integration risk.');

  // Option 2: rate only Timing (1 of 5).
  await rateCell('Timing', optionBColumn, 'After end date', 'Vendor cannot commit to a date.');

  await expect(page.getByText(/Option 1: 2 of 5 rated/)).toBeVisible();
  await expect(page.getByText(/Option 2: 1 of 5 rated/)).toBeVisible();

  // Unrated cells read "Not rated," visibly distinct from a rated one.
  const effortRowForOptionA = criteriaTable.locator('tr', { hasText: 'Effort' });
  await expect(effortRowForOptionA.locator('button').nth(optionAColumn - 1)).toContainText('Not rated');

  // Recorded ratings show their own criterion label, not a raw level key.
  const costRow = criteriaTable.locator('tr', { hasText: 'Cost' });
  await expect(costRow.locator('button').nth(optionAColumn - 1)).toContainText('Low');
  const timingRow = criteriaTable.locator('tr', { hasText: 'Timing' });
  await expect(timingRow.locator('button').nth(optionBColumn - 1)).toContainText('After end date');

  // Choose option 1 — unrated criteria did not block it.
  const optionARow = page.locator('li', { hasText: 'Option 1' });
  await optionARow.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('Option 1 is cheaper and ready sooner.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect(page.getByText('accepted', { exact: true })).toBeVisible();

  // The ratings recorded before choosing are still shown afterwards...
  await expect(costRow.locator('button').nth(optionAColumn - 1)).toContainText('Low');
  await expect(page.getByText(/Option 1: 2 of 5 rated/)).toBeVisible();

  // ...and are now read-only: the cell is no longer a live tap target.
  await expect(costRow.locator('button').nth(optionAColumn - 1)).toBeDisabled();
});
