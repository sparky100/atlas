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
import { signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';
import { optionSurface, ratingControl } from './fixtures/decisionLayout';

test('rate decision options on judgement criteria, leave some unrated, choose one with a rationale; ratings stay recorded and read-only afterwards', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'ratings');

  await clickNavItem(page, 'Decisions');
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
  for (const [, title] of optionSpecs) {
    await page.getByRole('button', { name: '+ Add an option' }).click();
    await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(title);
    await page.getByRole('button', { name: 'Add option' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  }

  // The criteria grid renders once both options are linked (F6.3 folded the
  // old separate Options list into its own column headers — find which
  // header column belongs to which option (`decision_links` carries no
  // guaranteed order) rather than assuming insertion order.
  const criteriaGrid = page.getByTestId('decision-criteria-grid');
  await expect(criteriaGrid).toBeVisible();
  const optionAHeader = optionSurface(page, 'Option 1');
  const optionBHeader = optionSurface(page, 'Option 2');
  await expect(optionAHeader).toBeVisible();
  await expect(optionBHeader).toBeVisible();

  async function rateCell(criterionLabel: string, title: string, levelLabel: string, note: string) {
    await (await ratingControl(page, title, criterionLabel)).click();
    const editor = page.getByTestId('decision-rating-editor');
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: levelLabel }).click();
    await editor.getByPlaceholder('A short reason for this rating').fill(note);
    await editor.getByRole('button', { name: 'Save rating' }).click();
    await expect(editor).toHaveCount(0);
  }

  await rateCell('Cost', 'Option 1', 'Low', 'Cheaper than the incumbent.');
  await rateCell('Delivery risk', 'Option 1', 'Medium', 'Some integration risk.');
  await rateCell('Timing', 'Option 2', 'After end date', 'Vendor cannot commit to a date.');

  await expect(optionAHeader).toContainText('2/5');
  await expect(optionBHeader).toContainText('1/5');
  const effortControl = await ratingControl(page, 'Option 1', 'Effort');
  const costControl = await ratingControl(page, 'Option 1', 'Cost');
  const timingControl = await ratingControl(page, 'Option 2', 'Timing');
  await expect(effortControl).toContainText('Not rated');
  await expect(costControl).toContainText('Low');
  await expect(timingControl).toContainText('After end date');

  // Choose/Add-option follow-up ("no full-page loading state after the
  // first load"): a hand-set attribute with no React counterpart, on a
  // node that sits inside useDecision's own state — it only survives an
  // action if that action never unmounts-and-remounts this subtree (the
  // historical bug: useDecision's reload() always showed a page-level
  // "Loading…" first, tearing this whole tree down and rebuilding it).
  const mountMarker = 'stayed-mounted';
  await criteriaGrid.evaluate((el, marker) => {
    el.setAttribute('data-e2e-marker', marker);
  }, mountMarker);

  // Choose option 1 — unrated criteria did not block it. The "Choose"
  // action now lives in the criteria grid's own merged header (F6.3 folded
  // the old separate Options list into these headers).
  await optionAHeader.getByRole('button', { name: 'Choose' }).click();
  await page.getByPlaceholder('The reasons this option was chosen over the others').fill('Option 1 is cheaper and ready sooner.');
  await page.getByPlaceholder(/the vendor price rises/).fill('The vendor price rises or support is extended.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect(page.getByText('accepted', { exact: true })).toBeVisible();

  // The decision shows the chosen option and the rationale recorded at Choose time.
  await expect(optionAHeader).toContainText('chosen');
  await expect(page.getByText('Option 1 is cheaper and ready sooner.').first()).toBeVisible();
  // And what would make them reconsider, recorded at the same moment.
  await expect(page.getByRole('heading', { name: 'What we chose, why, and what would make us reconsider' })).toBeVisible();
  await expect(page.getByText('The vendor price rises or support is extended.')).toBeVisible();

  // The page never blanked during Choose — the marker set above is still
  // on the same DOM node.
  await expect(criteriaGrid).toHaveAttribute('data-e2e-marker', mountMarker);

  // The ratings recorded before choosing are still shown afterwards...
  await expect(costControl).toContainText('Low');
  await expect(optionAHeader).toContainText('2/5');

  // ...and are now read-only: the cell is no longer a live tap target.
  await expect(costControl).toBeDisabled();

  // The rejected option (Option 2) stays visible in the grid, not removed —
  // its own column, status chip, and previously-recorded rating remain.
  await expect(optionBHeader).toBeVisible();
  await expect(optionBHeader).toContainText('not chosen');
  await expect(timingControl).toContainText('After end date');

  // A comment write doesn't blank the page either — same marker, still
  // there after posting, and the ratings/chosen state Choose just
  // recorded are still exactly as they were, undisturbed by an unrelated
  // write.
  await page.getByPlaceholder('Write a comment…').fill('Noting this for the record.');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Noting this for the record.')).toBeVisible();
  await expect(criteriaGrid).toHaveAttribute('data-e2e-marker', mountMarker);
  await expect(optionAHeader).toContainText('chosen');
  await expect(costControl).toContainText('Low');

  // Decision-side-completion item 5: "Work on this option" enters the
  // change workspace and selects the chosen option as the session's
  // editing ref, the exact same editing-ref mechanism the change
  // page itself offers - never a second, invented mechanism.
  await optionAHeader.getByRole('button', { name: 'Work on this option' }).click();
  await expect(page).toHaveURL(/\/changes\//);
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();
});
