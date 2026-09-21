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
 * The replacement system supports the capability before being retired so
 * this same change also demonstrates the (unrelated) `supports`-edge
 * transfer `useElementRetire.ts`'s "replaced by" picker does alongside the
 * real `replaces` edge (ADR-001 amendment) — but the roadmap's own
 * replacement arrow (`deriveRoadmapChangeEvents`, `src/db/roadmapChangeEvents.ts`)
 * reads that `replaces` edge directly now, not a `supports` retract/create
 * pairing, so the arrow itself no longer depends on there being a
 * capability at all.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, goToModelHome, retireElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

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
  await page.getByPlaceholder(/^Name \(e\.g\./).fill('sunset-legacy-crm');
  await page.locator('select').selectOption('record');
  const targetDate = isoDateDaysFromNow(120);
  await page.locator('input[type="date"]').fill(targetDate);
  await page.getByRole('button', { name: 'Create change' }).click();
  await expect(page.getByText('Editing in change: sunset-legacy-crm')).toBeVisible();

  // Retire Legacy CRM, replaced by New CRM Platform, inside this change.
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Legacy CRM');
  await page.getByRole('link', { name: 'Legacy CRM' }).click();
  await expect(page.getByRole('heading', { name: 'Legacy CRM' })).toBeVisible();
  await retireElement(page, isoDateDaysFromNow(90), 'New CRM Platform');
  await expect(page.getByText(/Replaced by/)).toBeVisible();

  // Submit and merge — record's single-reviewer weight puts "Approve &
  // merge" directly on the change's own page, no review queue involved.
  await page.getByRole('link', { name: 'Changes' }).click();
  await page.locator('li', { hasText: 'sunset-legacy-crm' }).getByRole('link', { name: 'Open →' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('proposed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve & merge' }).click();
  await expect(page.getByText('merged', { exact: true }).first()).toBeVisible();

  // The roadmap: the merged change's own replacement arrow, in its own
  // target quarter.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Roadmap' }).click();
  await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible();
  await expect(page.getByText(quarterLabelDaysFromNow(120))).toBeVisible();
  await expect(page.locator('[data-kind="replace"]').first()).toBeVisible();
  // ADR-001 amendment: no capability clause — a replaces edge is a direct
  // system-to-system fact, read straight off the change's own delta.
  await expect(page.getByText('Legacy CRM replaced by New CRM Platform')).toBeVisible();
});
