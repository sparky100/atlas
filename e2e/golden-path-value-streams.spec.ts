/**
 * S2 coverage (docs/prompts/atlas-prompt-pack.md §2) — F6's own golden
 * path, click-only from Home: seed the electricity map (which now carries
 * value streams, v4), add a system supporting the "Connections" capability
 * (one of those that enables a Getting Connected stage), retire it, then
 * read the weakness back up the value stream — Getting Connected shows the
 * stage, tapping it reveals the capability and the retiring system, and
 * "Start a decision" opens the form pre-filled.
 *
 * Runs at 1280 (chromium) and 390 (chromium-390, `testMatch:
 * /golden-path-.*\.spec\.ts/`) — the only viewport-dependent step is that
 * the mobile list renders each stream as a collapsed accordion (its stages
 * hidden until expanded), so the stream is expanded before tapping the
 * stage; on desktop the stream is already flat and that toggle isn't a
 * button, so the click is skipped.
 *
 * Prerequisite (release step, not this spec): the electricity map must be
 * loaded *and* published at v4 in the environment Playwright runs against —
 * `pnpm content:load-capability-maps` then
 * `pnpm content:publish-capability-map electricity_network 4` — otherwise
 * the seeded map has no value streams and this path has nothing to show.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, retireElement, seedStarterCapabilityMap, signUpCreateOrgAndModel, clickNavItem } from './fixtures/goldenPath';

test('a retired capability supporter reads as weakness up the value stream', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-vs');

  // Seed the electricity map (v4 — capabilities plus value streams).
  await seedStarterCapabilityMap(page, /electricity/i);

  // A system supporting "Connections" — one of the capabilities that enable
  // Getting Connected's "Design & Offer" and "Energise & Settle" stages.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Legacy CRM', description: 'The retiring connections platform.', capabilityName: 'Connections' });

  // Retire it — the stage rollup rolls up to warn.
  await retireElement(page, '2026-12-31');

  await clickNavItem(page, 'Value streams');
  await expect(page.getByRole('heading', { name: 'Value streams' })).toBeVisible();

  // Mobile (390): each stream is a collapsed accordion — expand Getting
  // Connected. Desktop (1280): streams render flat, and there is no such
  // button, so this is a no-op.
  // Wait for the streams to render first — `isVisible()` doesn't wait, so
  // checking it before the list loads skipped the expand on a phone.
  await expect(page.getByText(/Getting Connected/).first()).toBeVisible();
  const streamAccordion = page.getByRole('button', { name: /Getting Connected/ });
  if (await streamAccordion.isVisible()) await streamAccordion.click();

  // Tap the weak "Design & Offer" stage.
  const stage = page.getByRole('button', { name: /Design & Offer/ });
  await expect(stage).toBeVisible();
  await stage.click();

  // The inspector shows the enabling capability and its (now retiring)
  // supporting system.
  await expect(page.getByRole('link', { name: 'Connections' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Legacy CRM' })).toBeVisible();

  // Start a decision from the weak stage; the form opens pre-filled.
  await page.getByRole('link', { name: 'Start a decision →' }).click();
  await expect(page).toHaveURL(/startFindingKey=weak-stage/);
});
