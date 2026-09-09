/**
 * Sprint C1's own core user path (the user's brief: "Tests: ... Playwright
 * for the full create-edit-view-merge path"): create a change branch, edit
 * an attribute while it's selected (writing a delta to the branch, not
 * main), see the As-is/To-be/Diff selector on a canvas view, see the
 * change reflected on its own page, submit it for review, approve, merge —
 * and see the new value on main afterward.
 *
 * Same "needs a real Supabase, no product path to a genesis commit yet"
 * limitation as every other spec here (e2e/element-edit.spec.ts's own
 * comment; e2e/fixtures/changeBranchFixture.ts factors the bootstrap out).
 *
 * This test is also what proved a real gap: `useElementEditor` (and its
 * siblings) were already generalised to take any `branch: BranchRow` in
 * Sprint C1 step 4, but src/ui/routes/ElementPage.tsx kept feeding them
 * `useMainBranch()` regardless of `?ref=` — so "editing while a change is
 * selected writes deltas to the branch" had no real UI path at all until
 * Sprint C1 step 9 wired `useEditingBranch` in. Without that fix, the
 * `Edit` button below would never even render at `?ref=branch:...`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { createChangeBranch } from '../src/db/branches';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('create a change, edit it on its own branch, view it, submit, approve, and merge', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'cbmerge', 'Billing Service');
  const { orgSlug, modelSlug, systemId } = fixture;

  // 1. Create the change branch through the real "Changes" form.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes`);
  const changeName = `retire-legacy-vendor-${randomUUID().slice(0, 8)}`;
  const changeTitle = 'Point Billing Service at the new vendor';
  await page.getByPlaceholder('Name (e.g. retire-legacy-crm)').fill(changeName);
  await page.getByPlaceholder('Title (e.g. Retire the legacy CRM)').fill(changeTitle);
  await page.getByPlaceholder('Description (optional)').fill('Swap Billing Service onto Acme Corp.');
  await page.getByRole('button', { name: 'Create change' }).click();

  const changeRow = page.locator('li', { hasText: changeTitle });
  await expect(changeRow).toBeVisible();
  await changeRow.getByRole('link', { name: 'Open →' }).click();

  // 2. The change's own page: draft, up to date, nothing to review yet.
  await expect(page.getByRole('heading', { name: changeTitle })).toBeVisible();
  await expect(page.getByText('draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Up to date with main.')).toBeVisible();
  const branchIdMatch = /\/changes\/([^/?]+)/.exec(page.url());
  if (!branchIdMatch?.[1]) throw new Error(`could not read the branch id out of ${page.url()}`);
  const branchId = branchIdMatch[1];

  // 3. Edit while the change is selected: this must write to the branch,
  // not main — the real point of this whole spec (see module comment).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=branch:${branchId}`);
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();
  await expect(page.getByText('Acme Corp')).toHaveCount(0);
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor').fill('Acme Corp');
  await page.getByRole('button', { name: 'Save' }).click();
  // A real commit round trip (write the delta, re-fetch the element) — the
  // default 5s expect timeout is tight for a freshly-started local
  // Supabase's first real request; the overall 30s test timeout is the
  // real backstop.
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible({ timeout: 15_000 });
  // `exact: true`, not a bare substring match: HistoryTimeline.tsx renders
  // every delta ever asserted about this subject — model-scoped, not
  // filtered to the current ref (its own doc comment: "the audit trail",
  // deliberately not a projection) — as `${attribute}: ${JSON.stringify(value)}`,
  // so "Attributes" now genuinely reads `Acme Corp` while "History" reads
  // `vendor: "Acme Corp"` on the very same page. A bare substring match
  // resolves both (Playwright strict mode rejects that); the exact node
  // text is what actually distinguishes "the value now says this" from
  // "some delta somewhere mentions this".
  await expect(page.getByText('Acme Corp', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Main is untouched by the branch's own edit (baseline stays baseline
  // until merge) — the isolation the whole "changes as branches" model
  // exists to guarantee. The branch's own delta already exists in the
  // audit trail regardless of ref (same History caveat as above), so this
  // checks the exact attribute value is absent, not that no delta
  // anywhere mentions it.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByText('Acme Corp', { exact: true })).toHaveCount(0);

  // 4. Every view can switch between As-is/To-be/Diff once a branch ref is
  // selected (the user's own brief, item 3) — the Landscape canvas itself
  // is Canvas 2D, not DOM (e2e/landscape-navigation.spec.ts's own comment
  // on why its node content isn't Playwright-queryable), so this checks
  // the segmented control renders and switches without asserting on
  // canvas pixels.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape?ref=branch:${branchId}`);
  const modeControl = page.getByRole('tablist', { name: 'As-is, To-be, or Diff' });
  await expect(modeControl).toBeVisible();
  await expect(modeControl.getByRole('tab', { name: 'To-be' })).toHaveAttribute('aria-selected', 'true');
  await modeControl.getByRole('tab', { name: 'As-is' }).click();
  await expect(modeControl.getByRole('tab', { name: 'As-is' })).toHaveAttribute('aria-selected', 'true');
  await modeControl.getByRole('tab', { name: 'Diff' }).click();
  await expect(modeControl.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true');

  // 5. The change page's own summary of its deltas (Sprint C1 step 6).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
  await expect(page.getByText('Deltas on this change')).toBeVisible();
  await expect(page.getByText('vendor → Acme Corp')).toBeVisible();

  // 6. Submit for review (Sprint C1 step 7) — lands on the review request's own page.
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/review/`));
  await expect(page.getByText('pending', { exact: true })).toBeVisible();

  // No conflicts on a first submit against an unmoved main: one clean
  // change, nothing blocking, Approve enabled straight away.
  await expect(page.getByText('Clean changes (1)')).toBeVisible();
  await expect(page.getByText('0 blocking')).toBeVisible();
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  // Both the request's and the branch's own status chips read "approved"
  // at this point (atlas.approve_merge_request moves both) — `.first()`
  // rather than a strict-mode violation on the duplicate text.
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // 7. Main now has the merged value.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByText('Acme Corp', { exact: true })).toBeVisible();
});

/**
 * Sprint C1-H item 1's own diagnostics into the spec above (change the
 * branch, ✎ Edit never reappearing) traced back to `useElementPage.ts`
 * reading `elements_head` by commit id for a branch ref — a real bug, now
 * fixed (branch refs fold their head in memory instead, matching
 * `useLandscape.ts`'s own fix for the identical gap; SPEC §1 S-2). But
 * that investigation also surfaced a real gap in test coverage: nothing
 * proved what a *rejected* save actually does in the UI, so a real bug
 * there (e.g. `useElementEditor.ts`'s `save()` swallowing the error and
 * leaving the editor hung) could have shipped unnoticed. C13's optimistic-
 * concurrency check is the easiest real rejection to force outside a
 * database fault: race the branch's head out from under the open editor
 * (a direct `commitToBranch` call, exactly as a second real user editing
 * the same branch concurrently would).
 */
test('a failed save surfaces its error in the UI instead of leaving the editor open with no signal', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'cbmergeconflict', 'Support Portal');
  const { signedIn, orgId, orgSlug, modelId, modelSlug, userId, seedCommitId, createDeltaId, seedSourceId, systemId } = fixture;

  const branchId = randomUUID();
  await createChangeBranch(signedIn, { id: branchId, orgId, modelId, name: 'race-vendor', title: 'Race the vendor field', createdBy: userId, mainHeadCommitId: seedCommitId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}?ref=branch:${branchId}`);
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Vendor').fill('Page Value');

  // Commit directly to the same branch out from under the open editor —
  // it still holds `expectedHeadCommitId: seedCommitId` (the branch's head
  // when the page loaded), which this makes stale before Save is ever
  // clicked.
  const raceEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId,
    parentCommitId: seedCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'race: someone else edits the branch first',
    body: null,
    deltas: [{ kind: 'element.update', id: randomUUID(), elementId: systemId, elementType: 'system', attribute: 'vendor', value: 'Someone Else Value', previousDeltaId: createDeltaId, sourceId: seedSourceId, confidence: 1 }],
  };
  const raceResult = await commitToBranch(signedIn, { modelId, branchId, expectedHeadCommitId: seedCommitId, envelope: raceEnvelope });
  if (!raceResult.ok) throw new Error(`race commit: ${raceResult.message}`);

  await page.getByRole('button', { name: 'Save' }).click();

  // The real point of this test: a rejected save must surface a visible
  // error and hand control back to the user, not hang with a disabled
  // Save button and no signal.
  await expect(page.getByText('This element changed since you loaded it. Reload the page and try again.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});
