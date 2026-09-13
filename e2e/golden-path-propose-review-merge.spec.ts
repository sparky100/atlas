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
  const { orgName } = await signUpCreateOrgAndModel(page, 'goldenpath5');

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
  // point only appears for a contributor at main.
  const proposerEmail = `goldenpath5-proposer-${String(Date.now())}@example.test`;
  const proposerDisplayName = 'Priya Proposer';
  await inviteMemberFromHome(page, orgName, proposerEmail, 'contributor');

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

  await proposerPage.getByRole('button', { name: 'Submit for review' }).click();
  await expect(proposerPage.getByText('pending', { exact: true })).toBeVisible();

  // 4. Reviewer (the owner) views To-be, then requests changes. `page` is
  // already inside the model (the block above left it on ModelHome). Each
  // queue row's own navigable link just reads "Review →" — the change's
  // name is plain text alongside it, not the link itself.
  await page.getByRole('link', { name: 'Review queue' }).click();
  await page.locator('li', { hasText: changeName }).getByRole('link', { name: 'Review →' }).click();
  await expect(page.getByText('pending', { exact: true })).toBeVisible();
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
  await expect(proposerPage.getByText('pending', { exact: true })).toBeVisible();

  // 6. Reviewer approves and merges.
  await page.getByRole('link', { name: 'Review queue' }).click();
  await page.locator('li', { hasText: changeName }).getByRole('link', { name: 'Review →' }).click();
  const approveButton = page.getByRole('button', { name: 'Approve' });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText('approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // 7. Director sees the result: the merged change on main, from the
  // capability map door.
  await goToModelHome(page);
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
