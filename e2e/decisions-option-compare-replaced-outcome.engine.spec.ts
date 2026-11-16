/**
 * F6.3 (Part B)'s own-delta rework, item 1 (finishing the decision side of
 * Atlas): a decision concerning a *system* directly, where an option
 * introduces a real replacement — the outcome row must read "replaced by
 * <name>", derived from the option's own `OptionTouch`
 * (`computeSystemConcernOutcome`, `whatChangesRows.ts`).
 *
 * The option's own deltas here match the real "Retire…" action's own
 * shape (ADR-000, `useElementRetire.ts`): a lifecycle-retire `element.update`
 * on PM (never a retract — PM still exists throughout) plus a `replaces`
 * edge from the new replacement onto PM (ADR-001's `from = replacement,
 * to = retiring element`). This is exactly the sequence a bare
 * `element.retract` could never coexist with (C8/C9 — see
 * `decisions-option-compare-retire-outcome.engine.spec.ts`'s own module
 * comment) — the earlier "unreachable" finding was about the wrong delta
 * shape, not about this one, which the engine accepts cleanly.
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

test('a decision concerning a system directly, with an option that retires it and names a real replacement, shows the outcome row as "replaced by <name>"', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system ("PM") is the retiring concern itself.
  const fixture = await bootstrapChangeBranchFixture(page, env, 'decisionreplace', 'PM');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId: pmSystemId, seedSourceId, createDeltaId: pmCreateDeltaId } = fixture;

  // 1. Start the decision, linking PM (a system, not a capability) as its
  // one concern.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('link', { name: 'Decisions' }).click();
  const decisionTitle = `What replaces PM? ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Title (e.g. What replaces SAP PM?)').fill(decisionTitle);
  await page.getByPlaceholder('Context — why this decision needs making').fill('PM is end of life; Hana equivalent is the named replacement.');
  await page.getByRole('combobox').selectOption({ value: fixture.userId });
  await page.getByPlaceholder('Search capabilities or systems this decision concerns…').fill('PM');
  await page.getByRole('button', { name: 'PM' }).click();
  await page.getByRole('button', { name: 'Start decision' }).click();
  await expect(page.getByRole('heading', { name: decisionTitle })).toBeVisible();

  // 2. Add one option.
  await page.getByRole('button', { name: '+ Add an option' }).click();
  await page.getByPlaceholder("What's this option? (e.g. Replace with Workday)").fill('Option 1');
  await page.getByRole('button', { name: 'Add option' }).click();
  await expect(page.getByText('Option 1')).toBeVisible();

  // 3. On the option's own branch: create Hana equivalent, a `replaces`
  // edge onto PM, and PM's own lifecycle-retire delta — the real
  // "Retire… with a replacement picked" shape, no retract anywhere.
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

  const replacementId = randomUUID();
  const optionEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: optionBranchId,
    parentCommitId: optionBranch.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'retire PM, replaced by Hana equivalent',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: replacementId, elementType: 'system', name: 'Hana equivalent', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'replaces', fromElementId: replacementId, toElementId: pmSystemId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.update', id: randomUUID(), elementId: pmSystemId, elementType: 'system', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: pmCreateDeltaId, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const optionResult = await commitToBranch(owner, { modelId, branchId: optionBranchId, expectedHeadCommitId: optionBranch.head_commit_id, envelope: optionEnvelope });
  if (!optionResult.ok) throw new Error(`decisionreplace: retiring PM with a replacement on the option: ${optionResult.message}`);

  // 4. Back on the decision page: the Outcome row reads "replaced by Hana
  // equivalent" for this option, and the summary line names both the
  // retirement and the addition — the sprint's own worked example.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionUrlMatch[1]}`);
  const whatChangesTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Row' }) });
  await expect(whatChangesTable).toBeVisible();
  const outcomeRow = whatChangesTable.locator('tr', { hasText: 'Outcome' });
  await expect(outcomeRow).toContainText('unchanged'); // main's own column
  await expect(outcomeRow).toContainText('replaced by Hana equivalent'); // the option's own column

  const criteriaGridTable = page.locator('table').first();
  await expect(criteriaGridTable.locator('th', { hasText: 'Option 1' })).toContainText('Retires PM, adds Hana equivalent');
});
