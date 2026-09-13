/**
 * S2 flow 2 (docs/prompts/atlas-prompt-pack.md): "add a system with
 * description, capability (primary) and a verb-labelled uses
 * relationship." Click-only from Home; the target system for the `uses`
 * edge and the capability it supports are themselves created by clicking
 * (S2's own "no seeding beyond org and user" rule) — `add-a-system-flow.spec.ts`
 * seeds both via a raw commit for its own, narrower purpose, which this
 * golden path deliberately does not reuse.
 */
import { expect, test } from '@playwright/test';
import { addCapability, addSystemFromHome, addUsesRelationship, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('add a system with a description, a primary capability, and a verb-labelled uses relationship', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath2');

  await addCapability(page, 'Billing');
  await goToModelHome(page);

  // The uses target — a second, plain system with no capability.
  await addSystemFromHome(page, { name: 'Council Tax System', description: 'Handles council tax accounts.' });
  await goToModelHome(page);

  // The system this flow is actually about: description + primary capability.
  await addSystemFromHome(page, { name: 'Northgate', description: "The borough's new revenues platform.", capabilityName: 'Billing' });
  await expect(page.getByRole('link', { name: /Billing/ })).toBeVisible();

  await addUsesRelationship(page, 'Council Tax System', 'shares address data with');
  await expect(page.getByText('“shares address data with”')).toBeVisible();
  await expect(page.getByRole('link', { name: /Council Tax System/ })).toBeVisible();
});
