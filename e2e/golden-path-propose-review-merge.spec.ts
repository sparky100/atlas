/**
 * S2 flow 5 (docs/prompts/atlas-prompt-pack.md), the longest golden path:
 * "propose a change from an element page, work in it, leave, re-enter,
 * submit; reviewer views To-be, requests changes; proposer re-enters,
 * resubmits; reviewer approves, merges; director sees the result on the
 * capability map." Click-only from Home; the second member (the owner,
 * acting as reviewer) joins via the real invite-by-email UI, not
 * `members.insert`.
 *
 * "Reviewer requests changes": the button that actually does this
 * (`atlas.request_changes`, moving the branch back to Draft) is labelled
 * "Reopen for edits" (`ReviewRequestView.tsx`) — there is no button
 * literally reading "Request changes" in the current UI.
 */
import { expect, test } from '@playwright/test';
import { acceptInviteViaSignUp, addCapability, addSystemFromHome, goToModelHome, inviteMemberFromHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('propose a change from an element page, leave and re-enter it, submit; reviewer requests changes, proposer resubmits, reviewer approves and merges; director sees the result', async ({ page, browser }) => {
  // The longest golden path here — two real browser sessions and every
  // stage of a change's own lifecycle — comfortably exceeds Playwright's
  // 30s default under load; not flaky, just long.
  test.slow();
  const { orgName, ownerDisplayName } = await signUpCreateOrgAndModel(page, 'goldenpath5');

  // The system this change targets — created before the proposer's own
  // session ever mounts Home: `useHomeSearch.ts` loads its search pool
  // once per `commitId` at mount, so a proposer already sitting on Home
  // when this commit lands elsewhere would search a stale pool that never
  // includes it. Creating it first, before the proposer's session exists
  // at all, sidesteps that rather than depending on a live-refresh this
  // hook doesn't do.
  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Ledger Service', description: 'The system this change targets.', capabilityName: 'Finance' });

  // The org's own creator (owner) will act as reviewer; a second, invited
  // member (contributor) proposes the change — the propose-a-change entry
  // point only appears for a contributor at main. F3a's own architect floor
  // (`atlas.submit_merge_request`'s `v_min_architects`, default 1) means a
  // propose-intent submit also needs a real architect member in the org —
  // the owner can't become one themselves (an org must always keep its sole
  // owner, `org-settings-members.engine.spec.ts`'s own precedent), so a
  // third member is invited purely to exist as that architect; nothing else
  // in this test drives their own session beyond accepting the invite.
  const proposerEmail = `goldenpath5-proposer-${String(Date.now())}@example.test`;
  const proposerDisplayName = 'Priya Proposer';
  const architectEmail = `goldenpath5-architect-${String(Date.now())}@example.test`;
  await inviteMemberFromHome(page, orgName, proposerEmail, 'contributor');
  await inviteMemberFromHome(page, orgName, architectEmail, 'architect');

  const architectContext = await browser.newContext();
  const architectPage = await architectContext.newPage();
  await acceptInviteViaSignUp(architectPage, architectEmail, 'Alex Architect');

  const proposerContext = await browser.newContext();
  const proposerPage = await proposerContext.newPage();
  await acceptInviteViaSignUp(proposerPage, proposerEmail, proposerDisplayName);
  await proposerPage.getByRole('link', { name: orgName }).click();
  await proposerPage.getByRole('link', { name: /goldenpath5 Model/ }).click();

  // `inviteMemberFromHome` leaves `page` on Org settings, not OrgHome —
  // back into the model for the reviewer steps below.
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: /goldenpath5 Model/ }).click();

  // 1. Proposer, at main: "Propose a change" instead of "✎ Edit".
  await proposerPage.getByPlaceholder('Search or create a capability, system, or actor…').fill('Ledger Service');
  await proposerPage.getByRole('link', { name: 'Ledger Service' }).click();
  await expect(proposerPage.getByRole('heading', { name: 'Ledger Service' })).toBeVisible();
  await expect(proposerPage.getByRole('button', { name: '✎ Edit' })).toHaveCount(0);
  await proposerPage.getByRole('button', { name: 'Propose a change' }).click();
  // Prompt pack F0: an element page's own toggle defaults to `correct`
  // (`branchIntent.ts`'s `defaultIntentForEntryPoint('elementPage')`) — this
  // golden path's own scenario (a separate reviewer, "requests changes"
  // reopening the branch, an ordinary approve-then-merge on the shared
  // queue) is a `propose` story, so it switches the toggle explicitly
  // rather than accepting the default. A `record`/`correct` change never
  // reaches the shared `/review` queue this test walks through below
  // (`useReviewQueue.ts`'s own intent filter, PR3) — it merges in one click
  // from its own page instead, a different scenario this file doesn't test.
  await proposerPage.getByRole('button', { name: 'Propose a plan' }).click();

  const changeName = 'retire-ledger-vendor';
  await proposerPage.getByPlaceholder('Name (e.g. retire-northgate)').fill(changeName);
  await proposerPage.getByRole('button', { name: 'Create & continue' }).click();
  await expect(proposerPage.getByText(`Editing in change: ${changeName}`)).toBeVisible();

  // 2. Work in it: edit an attribute while the change is selected.
  await proposerPage.getByRole('button', { name: '✎ Edit' }).click();
  await proposerPage.getByLabel('Vendor', { exact: true }).fill('Ridgeline Systems');
  await proposerPage.getByRole('button', { name: 'Save' }).click();
  await expect(proposerPage.getByRole('button', { name: '✎ Edit' })).toBeVisible({ timeout: 15_000 });
  await expect(proposerPage.getByText(`Saved to change: ${changeName}`)).toBeVisible();

  // 3. Leave (Back to main) and re-enter (via "Changes" → the row's own
  // "Open →" link — not a re-typed URL) before submitting. Navigating to
  // the change's own page doesn't itself re-select it as the active ref
  // (the active ref is model-level session state, not parsed from the
  // URL — `ChangePage.tsx`'s own module comment); "Edit in this change" is
  // the explicit action that does.
  await proposerPage.getByRole('button', { name: 'Back to main' }).click();
  await expect(proposerPage.getByText(`Editing in change: ${changeName}`)).toHaveCount(0);
  await proposerPage.getByRole('link', { name: 'Changes' }).click();
  await proposerPage.locator('li', { hasText: changeName }).getByRole('link', { name: 'Open →' }).click();
  await proposerPage.getByRole('button', { name: 'Edit in this change' }).click();
  await expect(proposerPage.getByText(`Editing in change: ${changeName}`)).toBeVisible();

  // F3a: a propose-intent branch opens the reviewer picker instead of
  // submitting on this one click (`ChangeView.tsx`'s own `isMultiReviewerIntent`
  // branch) — the derived set (`deriveReviewers.ts`) already pre-checks the
  // invited architect (the only real candidate: nothing here maps an owner
  // actor to a member), but not the owner, who still needs to be in the
  // picked set to cast a verdict later (`atlas.set_review_verdict`'s own
  // "you are not a reviewer on this request" check) — checked explicitly.
  // `.last()`: the outer trigger button keeps the same label and stays
  // mounted once the picker opens below it.
  await proposerPage.getByRole('button', { name: 'Submit for review' }).click();
  await proposerPage.getByLabel(ownerDisplayName).check();
  await proposerPage.getByRole('button', { name: 'Submit for review' }).last().click();
  await expect(proposerPage.getByText('pending', { exact: true }).first()).toBeVisible();

  // 4. Reviewer (the owner) views To-be, then requests changes. `page` is
  // already inside the model (the block above left it on ModelHome). Each
  // queue row's own navigable link just reads "Review →" — the change's
  // name is plain text alongside it, not the link itself.
  //
  // F9 step 2: the queue is the Changes page's "Review queue" tab, not a
  // nav item. Once on Changes, the nav item's badge counts the one open
  // change and the tab the one item waiting (checked after the click:
  // `page` has been sitting on Home since before the proposer submitted,
  // and both counts are re-read when a page mounts).
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  const changesTabs = page.getByRole('navigation', { name: 'Changes views' });
  await nav.getByRole('link', { name: 'Changes' }).click();
  await expect(nav.getByRole('link', { name: 'Changes (1 open)' })).toBeVisible();
  await expect(changesTabs.getByRole('link', { name: 'Review queue (1 waiting)' })).toBeVisible();
  await changesTabs.getByRole('link', { name: 'Review queue' }).click();
  await expect(changesTabs.getByRole('link', { name: 'Review queue' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Changes' })).toHaveAttribute('aria-current', 'page');
  await page.locator('li', { hasText: changeName }).getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByText('pending', { exact: true }).first()).toBeVisible();
  // "View this change" links to the Landscape read-only at this branch's
  // ref (`ReviewRequestView.tsx`), not the element page directly.
  await page.getByRole('link', { name: 'View this change' }).click();
  await expect(page.getByRole('heading', { name: 'Landscape' })).toBeVisible();
  await expect(page).toHaveURL(/ref=branch:/);
  await page.goBack();
  await page.getByRole('button', { name: 'Reopen for edits' }).click();
  await expect(page.getByText('changes_requested', { exact: false }).or(page.getByText('draft', { exact: true })).first()).toBeVisible();

  // 5. Proposer re-enters and resubmits. Submitting for review reset the
  // active ref (same as "Back to main" — a submitted change isn't being
  // "edited" any more), so re-entering needs "Edit in this change" again.
  // The still-open merge request means the change page itself shows "Open
  // review →", not a plain "Submit for review" button — the actual
  // resubmit action lives on the review page it links to.
  await proposerPage.getByRole('link', { name: 'Changes' }).click();
  await proposerPage.locator('li', { hasText: changeName }).getByRole('link', { name: 'Open →' }).click();
  await proposerPage.getByRole('button', { name: 'Edit in this change' }).click();
  await expect(proposerPage.getByText(`Editing in change: ${changeName}`)).toBeVisible();
  await proposerPage.getByRole('link', { name: 'Open review →' }).click();
  await proposerPage.getByRole('button', { name: /resubmit/i }).click();
  await expect(proposerPage.getByText('pending', { exact: true }).first()).toBeVisible();

  // 6. Reviewers approve; the owner merges. F3a: the proposer's picker
  // pre-checked the architect as the one *required* reviewer and added the
  // owner as optional, so the request only reaches `approved` once the
  // architect approves — the owner's own Approve is a verdict, not the gate
  // (`atlas.set_review_verdict`). The architect reaches the queue the same
  // way any member does: Changes in the nav, then the Review queue tab.
  await architectPage.getByRole('link', { name: orgName }).click();
  await architectPage.getByRole('link', { name: /goldenpath5 Model/ }).click();
  await architectPage.getByRole('navigation', { name: 'Model navigation' }).getByRole('link', { name: 'Changes' }).click();
  await architectPage.getByRole('navigation', { name: 'Changes views' }).getByRole('link', { name: 'Review queue' }).click();
  await architectPage.locator('li', { hasText: changeName }).getByRole('link', { name: 'Review →' }).click();
  const architectApprove = architectPage.getByRole('button', { name: 'Approve' });
  await expect(architectApprove).toBeEnabled();
  await architectApprove.click();
  await expect(architectPage.getByText('approved', { exact: true }).first()).toBeVisible();
  await architectContext.close();

  await nav.getByRole('link', { name: 'Changes' }).click();
  await changesTabs.getByRole('link', { name: 'Review queue' }).click();
  await page.locator('li', { hasText: changeName }).getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // 7. Director sees the result: the merged change on main, from the
  // capability map door. With the one change merged, nothing is open, so
  // the Changes item's badge is gone (zero shows nothing).
  await goToModelHome(page);
  await expect(nav.getByRole('link', { name: /\(\d+ open\)/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Director view' }).click();
  await expect(page.getByRole('button', { name: 'Director view' })).toHaveAttribute('aria-pressed', 'true');
  // The capability map tile itself never links to a system by name — just
  // its own supporting-system count and a "→ Landscape" zoom link
  // (`CapabilityMapView.tsx`'s own doc comment: "every tile's
  // supporting-system count is also a link into the landscape filtered to
  // exactly those systems"). Finance now shows Ledger Service as its one
  // supporting system — that's the director-visible result.
  await page.getByRole('link', { name: 'Capability map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capability map' })).toBeVisible();
  const financeItem = page.getByRole('listitem').filter({ hasText: 'Finance' });
  await expect(financeItem).toBeVisible();
  // Below 768px, L1 groups collapse into an accordion, one open at a time
  // (`capability-map-mobile-accordion.spec.ts`) — the desktop tile shows
  // its supporting-system count and zoom link directly, with no toggle to
  // expand first. `.count()` (not a direct `.getAttribute()`) so a
  // desktop run — no button in this listitem at all, a plain `<Link>` per
  // `CapabilityMapView.tsx` — resolves empty rather than waiting forever
  // for one to appear; `financeItem` is already confirmed rendered above,
  // so `count()` here reads real DOM state, not a pre-render race.
  const financeToggle = financeItem.getByRole('button').first();
  if ((await financeToggle.count()) > 0 && (await financeToggle.getAttribute('aria-expanded')) === 'false') await financeToggle.click();
  // A capability-filtered Landscape replaces the "Landscape" heading
  // outright with "Systems supporting <name> (N)" (Sprint U4-2c item 2,
  // `LandscapePage.tsx`'s own doc comment) — not a plain "Landscape" page.
  // Scoped to the exact zoom-link text, not a bare "1 system" substring —
  // the mobile accordion toggle's own aggregate text ("Finance 0
  // capabilities · 1 system") contains that same substring too.
  await expect(financeItem.getByText('1 system →', { exact: true })).toBeVisible();
  await financeItem.getByRole('link', { name: /system.*→/ }).click();
  await expect(page.getByRole('heading', { name: /Systems supporting Finance/ })).toBeVisible();

  // The merged edit itself, confirmed on main via Home's own search door.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Ledger Service');
  await page.getByRole('link', { name: 'Ledger Service' }).click();
  await expect(page.getByRole('heading', { name: 'Ledger Service' })).toBeVisible();
  await expect(page.getByText('Ridgeline Systems', { exact: true })).toBeVisible();

  await proposerContext.close();
});
