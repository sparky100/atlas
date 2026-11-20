/**
 * S2 flow 4 (docs/prompts/atlas-prompt-pack.md): "add and remove a
 * relationship, promote a secondary supports." Two distinct relationship
 * actions — a `uses` edge added then removed, and a system with two
 * `supports` edges (both created secondary — a system's very first
 * supports link is always secondary, never asked,
 * `useElementCreate.ts`'s own doc comment) with one promoted to primary —
 * built entirely by clicking, per S2's own "no seeding beyond org and
 * user" rule.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSupportsRelationship, addSystemFromHome, addUsesRelationship, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('add and remove a uses relationship, then promote a secondary supports edge to primary', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath4');

  // --- Add and remove a relationship ---
  await addSystemFromHome(page, { name: 'System B', description: 'The uses target.' });
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'System A', description: 'The system whose relationship gets added and removed.' });
  await addUsesRelationship(page, 'System B', 'reads records from');
  await expect(page.getByRole('link', { name: /System B/ })).toBeVisible();

  const usesRow = page.locator('li, div').filter({ hasText: 'System B' }).filter({ hasText: 'reads records from' }).last();
  await usesRow.getByRole('button', { name: 'Relationship actions' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('System A will no longer use System B.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('link', { name: 'System B' })).toHaveCount(0);

  // --- Promote a secondary supports edge to primary ---
  await addCapability(page, 'Capability One');
  await addCapability(page, 'Capability Two');
  await goToModelHome(page);
  await addSystemFromHome(page, { name: 'Dual Support System', description: 'Supports two capabilities.', capabilityName: 'Capability Two' });
  await addSupportsRelationship(page, 'Capability One', false);

  // A capability's first supporter is its main one (`roleForNewSupporter`):
  // Capability Two had none, so Dual Support System is created Main there.
  // Capability One is added afterwards through the relationship form as
  // "Also"; promoting it below demotes Capability Two in the same commit.
  // Scoped to `RelationshipsSection.tsx`'s own `.rowGroup` wrapper (the one
  // ancestor that contains both the row's own text and its "Show
  // attributes" toggle as siblings) — a bare `li, div` filter matches
  // every nested wrapper down to the link's own tightly-scoped container,
  // and `.last()` on that resolves to one with no "Show attributes"
  // descendant at all.
  const capabilityRow = (name: string) => page.locator('[class*="rowGroup"]').filter({ hasText: name });
  const capOneRow = capabilityRow('Capability One');
  const capTwoRow = capabilityRow('Capability Two');
  await expect(capOneRow.getByText('Also', { exact: true })).toBeVisible();
  await expect(capTwoRow.getByText('Main', { exact: true })).toBeVisible();

  await capOneRow.getByRole('button', { name: 'Show attributes' }).click();
  await capOneRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await capOneRow.getByLabel('Role').selectOption('primary');
  await capOneRow.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(capabilityRow('Capability One').getByText('Main', { exact: true })).toBeVisible();
  await expect(capabilityRow('Capability Two').getByText('Also', { exact: true })).toBeVisible();

  // No horizontal overflow (meaningful at 390): each relationship row packs
  // an endpoint link, a role chip and a provenance badge onto one flex
  // line, which must wrap rather than spill past the viewport.
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
