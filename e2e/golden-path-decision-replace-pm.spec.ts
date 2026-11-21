/**
 * Decision-side-completion item 7b(c): the click-only counterpart of
 * `decisions-option-compare-replaced-outcome.engine.spec.ts` (item 1) —
 * same real "Retire… with a replacement picked" shape (ADR-000/ADR-001,
 * `useElementRetire.ts`), but reached entirely through the UI from Home
 * (S2's own rule) rather than a direct `commitToBranch` on the option's
 * own branch. The Outcome row must read "replaced by <name>".
 */
import { randomUUID } from 'node:crypto';
import { compactDecision, changesSurface, optionSurface } from './fixtures/decisionLayout';
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, retireElement, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('retiring PM on an option, with a real replacement picked, shows the Outcome row as "replaced by <name>"', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisionreplacepm');

  // PM, on main — the pre-existing concern every option is compared
  // against.
  await addSystemFromHome(page, { name: 'PM', description: 'The system to be replaced.' });

  // Start the decision, linking PM (a system, not a capability) as its
  // one concern.
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

  // One option, selected as the session's editing ref.
  const optionTitle = 'Replace PM with Hana';
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(optionTitle);
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText(optionTitle).first()).toBeVisible();

  await page.getByRole('link', { name: optionTitle }).click();
  // An option leads with "Draft this option's changes", which opens the landscape on this option (it becomes the editing ref).
  await page.getByRole('link', { name: "Draft this option's changes" }).click();
  await expect(page).toHaveURL(/landscape/);

  // On the option's own branch: create Hana equivalent (the replacement
  // must exist first, and creating it *here* — after selecting this
  // option as the editing ref — is what makes its own creation delta
  // belong to this option, not to main, matching the summary line's own
  // "adds Hana equivalent" wording below), then retire PM naming it as
  // the real replacement.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Hana equivalent', description: 'The named replacement, added on this option.' });
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('PM');
  await page.getByRole('link', { name: 'PM', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'PM' })).toBeVisible();
  await retireElement(page, '2026-06-01', 'Hana equivalent');
  await expect(page.getByText(/Replaced by/)).toBeVisible();
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible();

  // Back on the decision: the Outcome row reads "replaced by Hana
  // equivalent" for this option; main's own column stays "unchanged".
  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  const decisionRow = page.locator('li', { hasText: decisionTitle });
  await decisionRow.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const changes = changesSurface(page);
  await expect(changes).toBeVisible();
  await expect(changes).toContainText('Outcome');
  await expect(changes).toContainText('unchanged');
  await expect(changes).toContainText('replaced by Hana equivalent');
  if (!compactDecision(page)) {
    // Wide comparison keeps separate, non-overlapping columns.
    const headerBoxes = await changes.locator('thead th').evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, width: r.width })));
    expect(headerBoxes).toHaveLength(3);
    for (const [i, box] of headerBoxes.entries()) {
      expect(box.width).toBeGreaterThanOrEqual(80);
      const next = headerBoxes[i + 1];
      if (next) expect(box.right).toBeLessThanOrEqual(next.left + 1);
    }
  } else {
    await expect(changes).toContainText('Today');
    await expect(changes).toContainText('With this option');
  }
  await expect(optionSurface(page, optionTitle)).toContainText('Retires PM, adds Hana equivalent');
});
