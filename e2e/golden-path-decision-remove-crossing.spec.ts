/**
 * Decision-side-completion item 7b(b): an option that removes a boundary
 * crossing (a `uses` edge between an IT and an OT system) shows exactly
 * one visible What-changes row — the scoped "Boundary crossings" row,
 * since both declared system concerns (System A, System B) are otherwise
 * untouched and collapse — plus the option's own one-line summary
 * ("re-points 1 connection"). The same option also retires an unrelated,
 * undeclared system (System C) purely to give "Also affected" something
 * real to show: a touch that never lands in the structural table (only a
 * *declared* concern gets a row there), the one deliberate way this
 * scenario also exercises that section.
 *
 * Click-only from Home (S2's own rule): System B's `domain` is set via the
 * ordinary Attributes "✎ Edit" form (`attributeSchema.ts`'s own `domain`
 * field, `kind: 'enum'`) — there is no dedicated "set domain" control, but
 * the generic Attributes editor already renders every `attributeSchema.ts`
 * field, `domain` included, exactly like `criticality-and-hosting.engine.spec.ts`'s
 * own "Criticality"/"Hosting model" edits.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addSystemFromHome, addUsesRelationship, goToModelHome, retireElement, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('an option that removes an IT/OT boundary crossing shows only the scoped-crossings row and the summary line, and "Also affected" lists the unrelated system it also retired', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'decisioncrossing');

  // 1. System A (IT, the default domain) and System B (OT, set by hand),
  // then a `uses` edge between them — a genuine IT/OT boundary crossing.
  await addSystemFromHome(page, { name: 'System A', description: 'The IT-side system.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'System B', description: 'The OT-side system.' });
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Domain').selectOption('ot');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('OT', { exact: true }).first()).toBeVisible();

  // 2. An unrelated, third system — never declared as a decision concern,
  // and never connected to A or B — purely to populate "Also affected"
  // once the option retires it below.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'System C', description: 'An unrelated legacy system.' });

  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('System A');
  await page.getByRole('link', { name: 'System A', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'System A' })).toBeVisible();
  await addUsesRelationship(page, 'System B', 'sends readings to');
  await expect(page.getByRole('link', { name: /System B/ })).toBeVisible();

  // 3. Start the decision, declaring System A and System B (not System C)
  // as its own concerns.
  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  const decisionTitle = `Should we drop the A-to-B link? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('The A-to-B integration may no longer be needed.');
  await page.getByRole('combobox').selectOption({ index: 1 });
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('System A');
  await page.getByRole('button', { name: 'System A' }).click();
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('System B');
  await page.getByRole('button', { name: 'System B' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // 4. One option, then select it as the session's editing ref (the
  // exact "Draft this option's changes" mechanism, reused rather than reinvented
  // — decision-side-completion item 5).
  const optionTitle = 'Remove the crossing';
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill(optionTitle);
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText(optionTitle).first()).toBeVisible();

  await page.getByRole('link', { name: optionTitle }).click();
  // An option leads with "Draft this option's changes", which opens the landscape on this option (it becomes the editing ref).
  await page.getByRole('link', { name: "Draft this option's changes" }).click();
  await expect(page).toHaveURL(/landscape/);

  // 5. On the option's own branch: remove the uses edge (the crossing
  // itself), then retire System C with no replacement (the undeclared
  // touch "Also affected" exists to surface).
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('System A');
  await page.getByRole('link', { name: 'System A', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'System A' })).toBeVisible();
  // Double-filtered on the verb phrase too, not just "System B" —
  // History's own "created — uses System B" entry also matches a bare
  // `hasText: 'System B'` filter but never shows the verb phrase
  // (`golden-path-relationships-and-promote.spec.ts`'s own precedent for
  // this exact ambiguity).
  const usesRow = page
    .locator('div')
    .filter({ hasText: 'System B' })
    .filter({ hasText: 'sends readings to' })
    .last();
  await usesRow.getByRole('button', { name: 'Relationship actions' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('System A will no longer use System B.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('link', { name: 'System B' })).toHaveCount(0);

  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('System C');
  await page.getByRole('link', { name: 'System C', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'System C' })).toBeVisible();
  await retireElement(page, '2026-01-01');
  await expect(page.getByText('retiring', { exact: true }).first()).toBeVisible();

  // 6. Back on the decision: exactly one visible What-changes row (the
  // scoped crossings row), the option's own summary line, and "Also
  // affected" naming System C.
  await goToModelHome(page);
  await clickNavItem(page, 'Decisions');
  const decisionRow = page.locator('li', { hasText: decisionTitle });
  await decisionRow.getByRole('link', { name: 'Open →' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  const whatChangesTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
  await expect(whatChangesTable).toBeVisible();
  const crossingsRow = whatChangesTable.locator('tr', { hasText: 'Scoped crossings' });
  await expect(crossingsRow).toContainText('crossing');
  // Every visible row belongs to "Boundary crossings" — no Outcome/Trigger
  // row for System A or System B is showing, since neither system's own
  // lifecycle or existence changed, only the connection between them.
  await expect(whatChangesTable.getByText('Outcome', { exact: true })).toHaveCount(0);

  const criteriaGridTable = page.locator('table').first();
  await expect(criteriaGridTable.locator('th', { hasText: optionTitle })).toContainText('re-points 1 connection');

  await expect(page.getByRole('heading', { name: /Also affected/ })).toBeVisible();
  await expect(page.getByText('System C', { exact: true })).toBeVisible();
});
