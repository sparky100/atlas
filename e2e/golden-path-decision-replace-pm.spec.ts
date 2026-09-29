/**
 * Decision-side-completion item 7b(c): the click-only counterpart of
 * `decisions-option-compare-replaced-outcome.engine.spec.ts` (item 1) —
 * same real "Retire… with a replacement picked" shape (ADR-000/ADR-001,
 * `useElementRetire.ts`), but reached entirely through the UI from Home
 * (S2's own rule) rather than a direct `commitToBranch` on the option's
 * own branch. The Outcome row must read "replaced by <name>".
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, retireElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('retiring PM on an option, with a real replacement picked, shows the Outcome row as "replaced by <name>"', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisionreplacepm');

  // PM, on main — the pre-existing concern every option is compared
  // against.
  await addSystemFromHome(page, { name: 'PM', description: 'The system to be replaced.' });

  // Start the decision, linking PM (a system, not a capability) as its
  // one concern.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Decisions' }).click();
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
  await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill('replace-pm-with-hana');
  await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill(optionTitle);
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText(optionTitle).first()).toBeVisible();

  await page.getByRole('link', { name: optionTitle }).click();
  await page.getByRole('button', { name: 'Edit in this change' }).click();
  await expect(page.getByRole('button', { name: 'Editing in this change' })).toBeVisible();

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
  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionRow = page.locator('li', { hasText: decisionTitle });
  await decisionRow.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const whatChangesTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
  await expect(whatChangesTable).toBeVisible();
  const outcomeRow = whatChangesTable.locator('tr', { hasText: 'Outcome' });
  await expect(outcomeRow).toContainText('unchanged');
  await expect(outcomeRow).toContainText('replaced by Hana equivalent');

  const criteriaGridTable = page.locator('table').first();
  await expect(criteriaGridTable.locator('th', { hasText: optionTitle })).toContainText('Retires PM, adds Hana equivalent');
});
