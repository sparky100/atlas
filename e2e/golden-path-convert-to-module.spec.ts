/**
 * "Convert to a module of…" (`src/engine/convertSystemToModule.ts`'s own
 * module comment): a system created independently that turns out to have
 * been built on an existing platform all along becomes one of its modules —
 * its relationships carry over onto the new module, and its old name stays
 * searchable via an alias. Click-only from Home (S2's own rule) — no
 * seeding beyond org/user, no `page.goto` after the first, no URL
 * construction.
 *
 * Not executed in this sandbox — no Docker/local Supabase route (every
 * other `golden-path-*.spec.ts` in this session carries the same caveat).
 */
import { expect, test } from '@playwright/test';
import { addSystemFromHome, addUsesRelationship, goToModelHome, renameElement, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('convert a system into a module of an existing platform, carrying its relationships and old name across', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-converttomodule');

  // The platform this system turns out to have been built on all along.
  await addSystemFromHome(page, { name: 'SAP', description: 'The enterprise resource planning platform.' });
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Kind').selectOption('platform');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // A system created independently, that Freight Tracker uses — its own
  // relationship carries over onto the new module unchanged.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Customs Clearance', description: 'Handles customs paperwork.' });

  // The system that turns out to be one more module of SAP.
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Freight Tracker', description: 'Tracks freight shipments.' });
  await addUsesRelationship(page, 'Customs Clearance', 'submits customs declarations to');

  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Convert to a module of…' }).click();
  await page.getByPlaceholder('Search for the platform this is a module of…').fill('SAP');
  await page.getByRole('button', { name: new RegExp('SAP') }).click();
  await expect(page.getByText('The new module will still use Customs Clearance.')).toBeVisible();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  // Lands on the new module's own page — same name, now a module of SAP.
  await expect(page.getByRole('heading', { name: 'Freight Tracker' })).toBeVisible();

  // The relationship carried over onto the new module, unchanged.
  await expect(page.getByText('Customs Clearance')).toBeVisible();

  // Rename the module so the next search can only succeed via the old
  // name's alias, not the module's current name.
  await renameElement(page, 'FT');

  // "Old name found by search": Freight Tracker's own former name (now
  // aliased onto the module) still resolves, even though the module itself
  // is now named "FT" — same "old name found by search" story
  // `golden-path-merge-elements.spec.ts` already establishes for a merge.
  await goToModelHome(page);
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await searchBox.fill('Freight Tracker');
  await page.getByRole('link', { name: 'FT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'FT' })).toBeVisible();
});
