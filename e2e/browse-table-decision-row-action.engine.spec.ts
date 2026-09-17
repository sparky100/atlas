/**
 * Architect-door layout prompt (per-item-actions follow-up): "Multi-item
 * findings open the filtered list, where each row carries its own
 * pre-filled 'Start a decision'." A single-item decision-shaped finding
 * gets a direct "Start a decision →" right on its own door card instead
 * (covered by `decisions-start-and-why-here.engine.spec.ts`'s own
 * critical-support-end test) — this spec is the *multi*-item half: two
 * systems past their vendor support end, so the door card's one action
 * opens the browse table pre-filtered to the finding
 * (`ElementsPage.tsx`'s `?filter=critical-support-end`), and each row
 * there carries its own pre-filled "Start a decision"
 * (`ElementBrowseTable.tsx`'s `decisionRowAction`).
 *
 * Same "needs a real Supabase" limitation as every other spec here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('start a decision from one row of the critical-support-end finding\'s own filtered browse list', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'browserowdecision', 'SAP PM');
  const { signedIn: owner, orgSlug, modelId, modelSlug, systemId: sapPmId, createDeltaId, seedSourceId, main } = fixture;

  const sapFiId = randomUUID();
  const sapFiCreateDeltaId = randomUUID();
  const deltas: Delta[] = [
    // Two systems past support end — a *multi*-item finding, so the
    // door's own card falls through to the browse-table link rather than
    // a direct "Start a decision" (that single-item case is covered
    // elsewhere, `decisions-start-and-why-here.engine.spec.ts`).
    { kind: 'element.update', id: randomUUID(), elementId: sapPmId, elementType: 'system', attribute: 'criticality', value: 'critical', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.update', id: randomUUID(), elementId: sapPmId, elementType: 'system', attribute: 'supportEndsAt', value: '2020-01-01', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: sapFiCreateDeltaId, elementId: sapFiId, elementType: 'system', name: 'SAP FI', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, criticality: 'critical', supportEndsAt: '2019-06-01' }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed two systems past vendor support end', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`browse-row-decision fixture: seeding two support-end systems: ${seedResult.message}`);

  // 1. The architect door's own card: two items, so its one action is the
  // browse-table link, not a direct "Start a decision".
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Assurance' })).toBeVisible();
  await expect(page.getByText('2 critical systems past or near vendor support end')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a decision →' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Review →' }).click();

  // 2. The browse table, filtered to this finding — both systems show up,
  // each with its own "Start a decision" row action.
  await expect(page).toHaveURL(/\/elements\?filter=critical-support-end/);
  await expect(page.getByRole('link', { name: 'SAP PM', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SAP FI', exact: true })).toBeVisible();
  const sapFiRow = page.getByRole('row', { name: /SAP FI/ });
  await sapFiRow.getByRole('link', { name: 'Start a decision →' }).click();

  // 3. Lands on /decisions with title/context/link pre-filled with SAP
  // FI specifically — not SAP PM, the other row on the same filtered list.
  await expect(page).toHaveURL(/\/decisions\?/);
  await expect(page.getByPlaceholder('Title (e.g. What replaces SAP PM?)')).toHaveValue('Replace SAP FI?');
  await expect(page.getByPlaceholder('Context — why this decision needs making')).toHaveValue(/SAP FI/);
  await expect(page.getByText('SAP FI', { exact: true }).first()).toBeVisible(); // the pre-linked system, as a chip in the picker
});
