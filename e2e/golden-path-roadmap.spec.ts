/**
 * F5's own roadmap (docs/prompts/atlas-prompt-pack.md): "a retire-and-
 * replace change appears as an arrow in the target quarter." Click-only
 * from Home (S2's own rule) — a `record` change is used rather than
 * `propose` specifically because its single-reviewer weight
 * (`intentReviewWeight`) merges in one click from the change's own page,
 * the shortest real path to a *merged*, dated change branch (the only
 * kind `isRoadmapEligibleBranch` ever shows a marker for — see
 * `roadmapEligibility.ts`'s own module comment).
 *
 * The replacement system deliberately supports the capability *before*
 * being retired: `useElementRetire.ts`'s own "replaced by" picker only
 * transfers a `supports` edge the retiring system already has — retiring
 * a system with no capability at all produces no `relationship.retract`/
 * `.create` pair for `deriveRoadmapChangeEvents` to pair into a
 * replacement marker.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, homeSearchResult, retireElement, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function quarterLabelDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const quarter = Math.floor(d.getMonth() / 3) + 1;
  return `Q${String(quarter)} ${String(d.getFullYear())}`;
}

test('a retire-and-replace change, once merged, appears as an arrow on the roadmap in its own target quarter', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-roadmap');

  // The two systems: the one being retired (with a capability to transfer)
  // and its replacement.
  await addCapability(page, 'Customer Contact');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy CRM', description: 'The system to be retired.', capabilityName: 'Customer Contact' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'New CRM Platform', description: 'The replacement system.' });

  // A `record` change — F0's "something already happened" — carries the
  // one date (`Delivered date`) the roadmap plots the change's own marker
  // at, and merges in one click below without a review queue.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Changes' }).click();
  await page.getByLabel("What's this change?").fill('sunset-legacy-crm');
  await page.locator('select').selectOption('record');
  const targetDate = isoDateDaysFromNow(120);
  await page.locator('input[type="date"]').fill(targetDate);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByText('Editing in change: sunset-legacy-crm')).toBeVisible();

  // Retire Legacy CRM, replaced by New CRM Platform, inside this change.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Legacy CRM');
  await homeSearchResult(page, 'Legacy CRM').click();
  await expect(page.getByRole('heading', { name: 'Legacy CRM' })).toBeVisible();
  await retireElement(page, isoDateDaysFromNow(90), 'New CRM Platform');
  await expect(page.getByText(/Replaced by/)).toBeVisible();

  // Submit and merge — record's single-reviewer weight (`isMultiReviewer`
  // false for `record`/`correct`) means the review request page shows a
  // plain "Approve" (not the multi-reviewer verdict controls), followed by
  // "Merge" once approved — `ChangeView.tsx`'s own `afterSubmitted` always
  // navigates to the request's own page, so there's no separate review-
  // queue visit needed here.
  await page.getByRole('link', { name: 'Changes' }).click();
  await page.locator('li', { hasText: 'sunset-legacy-crm' }).getByRole('link', { name: 'Open →' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  // The change and its review request each carry a "proposed" chip once submitted.
  await expect(page.getByText('proposed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // The roadmap: the merged change's own replacement arrow, in its own
  // target quarter.
  await goToModelHome(page);
  // `exact: true`: the breadcrumb's own org/model links ("goldenpath-roadmap
  // Org …") substring-match "Roadmap" too, since this spec's own fixture
  // org/model names contain the word — only visible at the 1280 viewport,
  // where the breadcrumb renders (collapsed at 390, where this spec also
  // runs — S2's own "fix until they pass at 1280 and 390").
  await clickNavItem(page, 'Roadmap');
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();
  // The quarter axis thins its labels to fit the width (at 390 only every other quarter is
  // named), so the quarter label is only asserted where it has room; the dated change list
  // below proves the target date at every width.
  if ((page.viewportSize()?.width ?? 0) >= 1000) await expect(page.getByText(quarterLabelDaysFromNow(120))).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: `${targetDate} Legacy CRM replaced by New CRM Platform` })).toBeVisible();
  await expect(page.locator('[data-kind="replace"]').first()).toBeVisible();
  // No capability parenthetical: this event comes from the real `replaces`
  // edge the retire flow wrote (`roadmapChangeEvents.ts`'s direct-edge
  // path), which is capability-free by design — only the coincidental
  // supports-retract/create heuristic fallback ever attaches one.
  await expect(page.getByText('Legacy CRM replaced by New CRM Platform', { exact: true })).toBeVisible();

  // "Find on this roadmap": picking Legacy CRM (it has a planned end, so a bar) scrolls to its row and outlines it.
  const find = page.getByRole('combobox', { name: 'Find on this roadmap' });
  await find.fill('Legacy');
  await page.getByRole('option', { name: /Legacy CRM/ }).click();
  await expect(find).toHaveValue('');
  await expect(page.locator('[data-system-id][data-found="true"]').first()).toBeVisible();
  await expect(page.locator('[data-system-id][data-found="true"]').first()).toContainText('Legacy CRM');

  // Regression coverage for the reported bug: axis tick labels overlapping
  // right on load, on mobile — assert every rendered tick's bounding box
  // is disjoint from its neighbour's, at whatever width this run's own
  // project (1280 or 390) actually gives the axis.
  const axisTicks = page.getByRole('img', { name: 'Timeline by quarter' }).locator('> span');
  const boxes = (await axisTicks.all().then((ticks) => Promise.all(ticks.map((tick) => tick.boundingBox())))).filter((box): box is NonNullable<typeof box> => box !== null);
  boxes.sort((a, b) => a.x - b.x);
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1];
    const curr = boxes[i];
    if (prev && curr) expect(curr.x, `axis tick ${String(i)} overlaps the previous one`).toBeGreaterThanOrEqual(prev.x + prev.width);
  }
});
