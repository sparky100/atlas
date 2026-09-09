/**
 * Blocking: element creation — the search-first "Add" control (Landscape
 * for systems/actors, Container/Component pages for their own children,
 * and per relationship-type group on the element page). This test covers
 * the acceptance criterion named explicitly: "from an empty model, add two
 * systems and a `uses` relationship between them without any seeding" —
 * no starter map, no service-role bootstrap, nothing but ADR-018's own
 * genesis commit and this feature's own controls.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createOrganisation } from '../src/db/organisations';
import { createModel } from '../src/db/models';
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';

test('from an empty model, add two systems and a uses relationship between them, without any seeding', async ({ page }) => {
  const env = loadEnv();

  const email = `element-creation-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`element-creation fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`element-creation fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `element-creation-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Element Creation Test Org', slug: orgSlug, createdBy: userId });

  // No genesis bootstrap, no seedModelFromCapabilityMap — main already has
  // a real head (its own genesis commit, ADR-018) the instant createModel
  // returns, which is the whole precondition this test exercises.
  const modelId = randomUUID();
  const modelSlug = `element-creation-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Element Creation Test Model', slug: modelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);

  // First system: the empty state's own "Add a system" control (the copy
  // fix this feature made — it used to point at "the element page," which
  // was unreachable with nothing on the landscape yet).
  await expect(page.getByText('No systems yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add a system' }).click();
  await page.getByPlaceholder('Search or create a system…').fill('Billing Service');
  await page.getByRole('button', { name: 'Create system "Billing Service"' }).click();

  // On success, the element page opens.
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();

  // Second system: back on the Landscape, the header toolbar's "+ Add
  // system" (the landscape is no longer empty, so the empty-state variant
  // is gone — the persistent toolbar one is what's left).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await page.getByRole('button', { name: '+ Add system' }).click();
  await page.getByPlaceholder('Search or create a system…').fill('Payment Gateway');
  await page.getByRole('button', { name: 'Create system "Payment Gateway"' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Gateway' })).toBeVisible();

  // Search-first actually works, not just create: searching "Billing"
  // from here finds the real Billing Service, not a second one. `uses`
  // is one of the verb-phrase relationship types (Handoff — Flow: Add a
  // system, decision 6), so picking the target moves to a second stage
  // in the same overlay before the relationship is actually created.
  await page.getByRole('button', { name: '+ Add uses' }).click();
  await page.getByPlaceholder('Search…').fill('Billing');
  await page.getByRole('button', { name: /Billing Service/ }).click();
  await page.getByPlaceholder('e.g. reads customer records from').fill('reads invoices from');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // Sprint U4-1 B5: uses requires a verb-phrase label before the
  // relationship is actually created — "Add" stays disabled until one is
  // typed.
  const addLabelButton = page.getByRole('button', { name: 'Add', exact: true });
  await expect(addLabelButton).toBeDisabled();
  await page.getByPlaceholder('e.g. reads customer records from').fill('calls for payment authorisation');
  await expect(addLabelButton).toBeEnabled();
  await addLabelButton.click();

  // The relationship now shows on Payment Gateway's own element page — a
  // link to Billing Service, in the Relationships section. Following it
  // (rather than going back through Landscape, whose canvas is Canvas 2D,
  // not real DOM links — LandscapePage.tsx's own module comment) lands on
  // Billing Service's page, where the reverse direction should show too.
  const billingServiceLink = page.getByRole('link', { name: /Billing Service/ });
  await expect(billingServiceLink).toBeVisible();
  // The label itself is shown on the row too, not just collected and hidden.
  await expect(page.getByText('“calls for payment authorisation”')).toBeVisible();
  await billingServiceLink.click();
  await expect(page.getByRole('heading', { name: 'Billing Service' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Payment Gateway/ })).toBeVisible();
});
