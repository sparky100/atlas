/**
 * V2b's Inspector, Landscape rollout: the collapsed/expanded resting state
 * is remembered per user (`inspector_collapsed`, `user_preferences`) and
 * survives a reload — the one scenario `landscape-focus-and-filters.spec.ts`
 * doesn't already cover (that spec proves the panel's *content*: Selection/
 * Connections when a system is focused, and the Filters facets narrowing
 * the canvas).
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('landscape inspector: collapsing the panel with nothing focused persists across a reload', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'inspector', 'Solo System');
  const { orgSlug, modelSlug } = fixture;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });

  // Open by default (no saved preference yet) — the Filters section (and
  // its own Capability facet) is visible with nothing focused.
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('Filters', { exact: true })).toBeVisible();

  await inspector.getByRole('button', { name: 'Collapse inspector' }).click();
  await expect(inspector.getByText('Filters', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand inspector' })).toBeVisible();

  await page.reload();
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });
  // Still nothing focused, so the saved `false`-collapsed... `true`-collapsed
  // preference (not a current selection) decides the resting state.
  await expect(page.getByRole('button', { name: 'Expand inspector' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByText('Filters', { exact: true })).toBeHidden();
});
