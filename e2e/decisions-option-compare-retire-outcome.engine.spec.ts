/**
 * F6.3 (Part B)'s own-delta rework — golden path 3 of 3 (the sprint's own
 * go-ahead, decision 4/item 2): a decision concerning a *system* directly
 * (not a capability) gets its own single "Outcome" row (rule 5), not the
 * four capability metric rows. An option that retires the system — via a
 * bare `element.retract`, no `replaces` edge — must read "retired",
 * derived from the option's own `OptionTouch` (`computeSystemConcernOutcome`,
 * `whatChangesRows.ts`), never a second, independent calculation.
 *
 * This deliberately tests the "retired" branch, not "replaced": a
 * `replaces` edge pointing at an element and that element's own
 * `element.retract` can never coexist in any legal commit. C8
 * (`src/engine/deltas.ts`'s `apply()`) refuses `element.retract` while any
 * relationship — a `replaces` edge included, no special case for it —
 * still references the element; C9 refuses `relationship.create` whose
 * `toElementId` doesn't currently exist in the head, so the edge can't be
 * created *after* the retract either, and no other ordering is possible
 * within or across this option's own commits. Confirmed directly: a first
 * attempt at this spec created the replacement, a `replaces` edge onto PM,
 * then retracted PM in one commit, and `commitToBranch` rejected it with
 * exactly C8's own error. `computeSystemConcernOutcome`'s `'replaced'`
 * branch (`whatChangesRows.ts`) therefore appears to be unreachable by any
 * real delta sequence today — reported to the user rather than silently
 * worked around (this spec doesn't attempt to fix or route around that;
 * see the sprint's own report for the finding).
 *
 * Named `.engine.spec.ts` — see `decisions-option-compare-empty-state.engine.spec.ts`'s
 * own module comment for why. Same "needs a real Supabase" limitation as
 * every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('a decision concerning a system directly, with an option that retires it (no replacement), shows the outcome row as "retired"', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system ("PM") is the retiring concern itself.
  const fixture = await bootstrapChangeBranchFixture(page, env, 'decisionretire', 'PM');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId: pmSystemId, seedSourceId, createDeltaId: pmCreateDeltaId } = fixture;

  // 1. Start the decision, linking PM (a system, not a capability) as its
  // one concern — the same "Search capabilities or systems…" input and
  // click-a-result flow either element type uses (`DecisionLinkPicker.tsx`).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionTitle = `Should we retire PM? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('PM is end of life, with no replacement lined up yet.');
  await page.getByRole('combobox').selectOption({ value: fixture.userId });
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('PM');
  // The result button's accessible name includes its type-glyph label
  // ("system PM"), matching `DecisionLinkPicker.tsx`'s own render — the same
  // reason the existing `decisions-options-compare-choose.engine.spec.ts`
  // spec matches its own capability result by substring, not exact.
  await page.getByRole('button', { name: 'PM' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // 2. Add one option.
  const optionName = `option-a-${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder('Name (e.g. replace-with-workday)').fill(optionName);
  await page.getByPlaceholder('Title (e.g. Replace with Workday)').fill('Option 1');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Option 1')).toBeVisible();

  // 3. On the option's own branch: a bare `element.retract` on PM — no
  // other relationship touches it, so C8 (see this file's own module
  // comment) has nothing to block.
  const decisionUrlMatch = /\/decisions\/([^/?]+)/.exec(page.url());
  if (!decisionUrlMatch?.[1]) throw new Error(`could not read the decision id out of ${page.url()}`);
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const optionRow = page.locator('li', { hasText: 'Option 1' });
  await optionRow.getByRole('link', { name: 'Open →' }).click();
  const optionBranchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!optionBranchIdMatch?.[1]) throw new Error(`could not read the option's branch id out of ${page.url()}`);
  const optionBranchId = optionBranchIdMatch[1];
  const optionBranch = await getBranch(owner, optionBranchId);
  if (!optionBranch?.head_commit_id) throw new Error("the option's own branch has no head commit");

  const optionEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: optionBranchId,
    parentCommitId: optionBranch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'retire PM',
    body: null,
    deltas: [{ kind: 'element.retract', id: randomUUID(), elementId: pmSystemId, elementType: 'system', previousDeltaId: pmCreateDeltaId, sourceId: seedSourceId, confidence: 1 }],
  };
  const optionResult = await commitToBranch(owner, { modelId, branchId: optionBranchId, expectedHeadCommitId: optionBranch.head_commit_id, envelope: optionEnvelope });
  if (!optionResult.ok) throw new Error(`decisionretire: retiring PM on the option: ${optionResult.message}`);

  // 4. Back on the decision page: the Outcome row reads "retired" for this
  // option, and the summary line names the retirement.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionUrlMatch[1]}`);
  const whatChangesTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
  await expect(whatChangesTable).toBeVisible();
  const outcomeRow = whatChangesTable.locator('tr', { hasText: 'Outcome' });
  await expect(outcomeRow).toContainText('unchanged'); // main's own column
  await expect(outcomeRow).toContainText('retired'); // the option's own column

  const criteriaGridTable = page.locator('table').first();
  await expect(criteriaGridTable.locator('th', { hasText: 'Option 1' })).toContainText('Retires PM');
});
