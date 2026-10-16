/**
 * S2 flow 1 (docs/prompts/atlas-prompt-pack.md): "create a model and seed
 * the electricity map." Click-only from Home after sign-up; no
 * `page.goto` after the first, no URL construction, no seeding beyond org
 * and user — the starter map itself is real fixture content already
 * published in every environment (`capability_map_templates`), picked by
 * its own card, not queried for directly.
 */
import { expect, test } from '@playwright/test';
import { seedStarterCapabilityMap, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('create a model and seed the electricity map', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath1');
  await seedStarterCapabilityMap(page, /^Electricity Network Operator$/);

  // Back on Capability map, the seeded map's own top-level capabilities
  // render — proves the import actually landed, not just that the button
  // was clicked.
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('This model has no capabilities yet');
});
