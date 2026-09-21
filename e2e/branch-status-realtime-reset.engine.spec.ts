/**
 * Sticky ref close-out: "any transition that makes the branch non-editable
 * for the current user resets the active ref to main on every open tab
 * (realtime)." `sessionStorage` is per-tab (unlike cookies/localStorage,
 * which a `BrowserContext`'s pages share) — a second `Page` in the same
 * context, navigated to the same branch, is a faithful stand-in for a
 * second real browser tab: it gets its own independent selection, exactly
 * as it would in a real browser, while still sharing the same signed-in
 * session (same cookies).
 *
 * `useBranchStatusReset.ts` is what this proves: submitting for review on
 * one tab already clears *that* tab's own selection directly
 * (`ChangeView.tsx`), which this test does not need to re-prove — the
 * point here is the *other* tab, which never clicked anything, reacting to
 * the same `branches` row change over Realtime.
 *
 * Same "needs a real Supabase" limitation as every other spec here — this
 * one doubly so (Realtime, not just Postgres).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { addArchitectMember, bootstrapChangeBranchFixture, submitForReviewWithReviewers } from './fixtures/changeBranchFixture';

test('submitting for review on one tab resets the active ref on another open tab, over realtime', async ({ page, context }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'realtimereset', 'Ledger Service');
  const { signedIn, orgId, userId, modelId, orgSlug, modelSlug, seedSourceId } = fixture;
  // F3a's own architect floor — see addArchitectMember's own doc comment.
  await addArchitectMember(env, orgId, userId);

  // 1. Tab 1: create the change through the real form — lands inside it.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeTitle = `Realtime reset ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(`realtime-reset-${randomUUID().slice(0, 8)}`);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];

  // A real delta on the branch, seeded directly — `useSubmitForReview`
  // refuses to submit an empty change ("nothing to submit"), and this test
  // is about the realtime reaction to submitting, not the create-a-system
  // UI e2e/add-a-system-flow.spec.ts already covers.
  const branch = await getBranch(signedIn, branchId);
  if (!branch?.head_commit_id) throw new Error('change branch has no head commit');
  const systemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Realtime Reset System', parentId: null, attributes: { lifecycleStatus: 'planned', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'add a system', body: null, deltas };
  const result = await commitToBranch(signedIn, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
  if (!result.ok) throw new Error(`realtime-reset fixture: seeding a delta: ${result.message}`);

  // 2. Tab 2: same signed-in session (shared cookies via `context`), its
  // own independent `sessionStorage` (a real second tab's own selection,
  // made explicitly via `?ref=branch:…` — the same URL tab 1's own
  // reconciliation would carry, but tab 2 never opened tab 1's page, so it
  // has to say so itself, same as a bookmark or a link shared between
  // tabs would).
  const page2 = await context.newPage();
  await page2.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}?ref=branch:${branchId}`);
  await expect(page2.getByText(`Editing in change: ${changeTitle}`)).toBeVisible();

  // 3. Tab 1 submits for review — the branch leaves `draft`.
  await submitForReviewWithReviewers(page, false);
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));

  // 4. Tab 2, untouched since step 2, reacts to the same `branches` row
  // changing over Realtime: the banner disappears and the URL reverts —
  // no reload, no click, no navigation on this tab at all.
  await expect(page2.getByText(`Editing in change: ${changeTitle}`)).not.toBeVisible({ timeout: 15_000 });
  await expect(page2).not.toHaveURL(/ref=branch:/);

  await page2.close();
});
