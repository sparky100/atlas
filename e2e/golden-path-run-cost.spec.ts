/**
 * The portfolio-view data step: "Run cost" (`annualRunCost`), a banded,
 * judged core attribute on System (including a `kind: 'platform'` system)
 * and Container. Click-only from Home (S2's own rule) — set it on a
 * system and a container, see the band's own human label persist; a
 * capability never shows the field at all (it's system/container only);
 * clearing the value shows "Not entered", visibly distinct from the
 * `none_included` band's own "None / included" label.
 *
 * Same "needs a real Supabase" limitation as every other Playwright test
 * here.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addContainerFromHome, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('setting Run cost on a system and a container persists its label; a capability never shows the field; clearing it shows "Not entered"', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'runcost');

  // 1. A system: set Run cost, see the band's own label (never the raw
  // stored key) once saved.
  await addSystemFromHome(page, { name: 'Billing Service', description: 'The system this test sets Run cost on.' });
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();

  // Phone width: the edit control (a plain <select>, same as every other
  // enum attribute) must stay usable — no page-level horizontal overflow
  // once it's on screen, same check every other narrow-viewport spec in
  // this directory uses.
  await page.setViewportSize({ width: 380, height: 800 });
  await expect(page.getByLabel('Run cost')).toBeVisible();
  const hasHorizontalOverflowWhileEditing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflowWhileEditing).toBe(false);
  await page.setViewportSize({ width: 1280, height: 800 });

  // The help text shows while editing.
  await expect(page.getByText("Annual cost that stops if this is retired. Not a share of the platform's cost.")).toBeVisible();
  await page.getByLabel('Run cost').selectOption('under_50k');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  await expect(page.getByText('Run cost', { exact: true })).toBeVisible();
  await expect(page.getByText('Under £50k', { exact: true })).toBeVisible();
  // Never the raw stored key.
  await expect(page.getByText('under_50k', { exact: true })).toHaveCount(0);

  // 2. A container (any live system is a legal parent — same "no
  // kind: 'platform' restriction" the create-container golden path
  // already establishes): its own Run cost, independent of the system's.
  await goToModelHome(page);
  await addContainerFromHome(page, 'FI', 'Billing Service');
  await expect(page.getByRole('heading', { name: 'FI' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Run cost').selectOption('over_5m');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  // Plain "Run cost" — not "(module override)": unlike criticality/hosting
  // model/hosting provider/domain, a module's own Run cost is never
  // inherited from its parent platform.
  await expect(page.getByText('Run cost', { exact: true })).toBeVisible();
  await expect(page.getByText('Over £5m', { exact: true })).toBeVisible();
  await expect(page.getByText('Criticality (module override)', { exact: true })).toBeVisible();

  // 3. A capability never shows the field at all — it's a system/container
  // attribute only.
  await goToModelHome(page);
  await addCapability(page, 'Finance');
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Finance');
  await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await expect(page.getByText('Run cost', { exact: true })).toHaveCount(0);

  // 4. Back on the system: clearing Run cost shows "Not entered", visibly
  // distinct from the none_included band's own "None / included" label —
  // never treated as low or as "none".
  await goToModelHome(page);
  await page.getByPlaceholder('Search or create a capability, system, or actor…').fill('Billing Service');
  await page.getByRole('link', { name: 'Billing Service', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();
  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Run cost').selectOption('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  await expect(page.getByText('Not entered', { exact: true })).toBeVisible();
  await expect(page.getByText('Under £50k', { exact: true })).toHaveCount(0);
  await expect(page.getByText('None / included', { exact: true })).toHaveCount(0);
});
