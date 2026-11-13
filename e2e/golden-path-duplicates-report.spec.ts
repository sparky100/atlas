/**
 * F4 (docs/prompts/atlas-prompt-pack.md "duplicates report (Q1)"), ADR-019's
 * "Amended (F4, ...)" paragraph: "two near-duplicate systems, the architect
 * door's new stat links to the report, check now, merge from the report,
 * confirm the old name is found by search afterward." Click-only from Home
 * (S2's own rule) — no seeding beyond org/user, no `page.goto` after the
 * first, no URL construction.
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('flag two near-duplicate systems, check from the report, merge, find the old name by search', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-duplicates');

  // "PowerON"/"Power On" — the same deliberately-messy near-duplicate
  // spelling pair the detection RPC's own integration test uses.
  await addSystemFromHome(page, { name: 'PowerON', description: 'The building management power controller.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Power On', description: 'Near-duplicate created by mistake.' });

  // The architect door's own fifth stat — real from F4, previously a
  // permanent "wired to 0" placeholder — links straight to the report.
  // Nothing has run a check yet, so this is still 0 the first time it's
  // clicked; that's the ordinary case, not a special one to work around.
  await goToModelHome(page);
  await page.getByRole('link', { name: /duplicates? flagged/ }).click();
  await expect(page.getByRole('heading', { name: 'Duplicates report' })).toBeVisible();

  await page.getByRole('button', { name: 'Check now' }).click();

  // The report row's own "Merge into <name>" — clicking the one naming
  // "PowerON" merges "Power On" into it, regardless of which of the pair
  // the detection query happened to store as element_a vs element_b.
  const mergeIntoPowerOn = page.getByRole('link', { name: 'Merge into PowerON' });
  await expect(mergeIntoPowerOn).toBeVisible({ timeout: 15_000 });
  await mergeIntoPowerOn.click();

  // Lands on "Power On"'s own page (the loser), with the merge panel
  // already pointed at "PowerON" — no search step, unlike E7's own
  // element-page "Merge into…" (mergePrefill.ts's own doc comment).
  await expect(page.getByText('Merging into PowerON.')).toBeVisible();
  await page.getByLabel('Why are these the same real thing?').fill('PowerON and Power On are the same real system.');
  await page.getByRole('button', { name: 'Merge', exact: true }).click();

  // Merging retracts "Power On"; the action lands on "PowerON" instead.
  await expect(page.getByRole('heading', { name: 'PowerON' })).toBeVisible();
  await expect(page.getByText('Merged "Power On" into "PowerON"')).toBeVisible();

  // "Old name found by search": the loser's own former name is now a real
  // alias of the survivor.
  await goToModelHome(page);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBox.fill('Power On');
  await page.getByRole('link', { name: 'PowerON', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'PowerON' })).toBeVisible();

  // The merged-away pair no longer flags a stray candidate — the report's
  // own join-based exclusion (src/db/duplicates.ts's own doc comment), not
  // just a matter of the check never having re-run since the merge.
  await goToModelHome(page);
  await expect(page.getByRole('link', { name: '0 duplicates flagged' })).toBeVisible();
});
