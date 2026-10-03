/**
 * OrgHome and ModelHome's core user path (Sprint H1 item 9, closing the
 * audit's own "zero Playwright coverage" finding for both —
 * docs/AUDIT-2026-09-U2.md §5.3): sign up, create an organisation through
 * the UI, land on OrgHome and see the owner role chip, create a model
 * through the UI, land on ModelHome. Sprint U3b replaced ModelHome's own
 * placeholder link list with the two front doors (UI-principles §3) —
 * this test's own tail now checks that redesign's presence for a brand
 * new, still-empty model (an owner's default door, the search box, the
 * browse-elements link); e2e/front-doors-and-browse.spec.ts is the real
 * coverage for the doors' seeded-model content, switching, search, and
 * table behaviour.
 *
 * Entirely UI-driven, no Node-side seeding: org/model creation already has
 * a real form (Home.tsx, ModelList.tsx) — unlike element-edit.spec.ts and
 * its siblings, which seed a System because there's no "create a system"
 * flow yet, this path needs nothing this UI can't already do itself.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('sign-up through org and model creation to ModelHome\'s front doors', async ({ page }) => {
  const email = `orghome-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const orgName = `Org ${randomUUID().slice(0, 8)}`;
  const modelName = `Model ${randomUUID().slice(0, 8)}`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  await expect(page.getByText("You're not a member of any organisation yet")).toBeVisible();

  // F3a's sign-up shape: a brand-new user with zero orgs picks "Just me"
  // or "My organisation" — "New organisation" only appears once an org
  // already exists. This spec wants a real, named org (it goes on to
  // exercise the owner role chip and model creation), so "My organisation".
  await page.getByRole('button', { name: 'My organisation' }).click();
  await page.getByPlaceholder('Organisation name').fill(orgName);
  await page.getByRole('button', { name: 'Create' }).click();

  // Prompt 7h bug fix: creating this, this account's first organisation,
  // is also the first time `atlas.ensure_profile` gives it a profile —
  // Home's own display-name gate replaces the page until one is given.
  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
  const displayName = `Org Home Owner ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Continue' }).click();

  const orgLink = page.getByRole('link', { name: orgName });
  await expect(orgLink).toBeVisible();
  await orgLink.click();

  // OrgHome: the org's own name, the owner role chip (a fresh org's
  // creator is always its owner, ADR-009), and no models yet.
  await expect(page.getByRole('heading', { name: orgName })).toBeVisible();
  await expect(page.getByText('owner', { exact: true })).toBeVisible();
  await expect(page.getByText('No models yet. A model is one landscape')).toBeVisible();

  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByPlaceholder('Model name').fill(modelName);
  await page.getByRole('button', { name: 'Create' }).click();

  const modelLink = page.getByRole('link', { name: modelName });
  await expect(modelLink).toBeVisible();
  await modelLink.click();

  // ModelHome: the model's own name, the door switch (a fresh org's
  // creator is its owner, so the architect door is the default —
  // UI-principles §3), the search box, and the browse-elements link.
  await expect(page.getByRole('heading', { name: modelName })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My work', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByPlaceholder('Search or create a capability, system, or actor…')).toBeVisible();

  const browseLink = page.getByRole('link', { name: 'Browse all elements →' });
  await expect(browseLink).toBeVisible();
  await browseLink.click();
  await expect(page).toHaveURL(/\/elements$/);
});
