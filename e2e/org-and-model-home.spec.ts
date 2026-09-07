/**
 * OrgHome and ModelHome's core user path (Sprint H1 item 9, closing the
 * audit's own "zero Playwright coverage" finding for both —
 * docs/AUDIT-2026-09-U2.md §5.3): sign up, create an organisation through
 * the UI, land on OrgHome and see the owner role chip, create a model
 * through the UI, land on ModelHome and see its three real links
 * (capability map, landscape, versions).
 *
 * Entirely UI-driven, no Node-side seeding: org/model creation already has
 * a real form (Home.tsx, ModelList.tsx) — unlike element-edit.spec.ts and
 * its siblings, which seed a System because there's no "create a system"
 * flow yet, this path needs nothing this UI can't already do itself.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('sign-up through org and model creation to ModelHome\'s three links', async ({ page }) => {
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

  await page.getByRole('button', { name: 'New organisation' }).click();
  await page.getByPlaceholder('Organisation name').fill(orgName);
  await page.getByRole('button', { name: 'Create' }).click();

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

  // ModelHome: the model's own name and its three real links — no fourth
  // "browse an element" link, per this page's own "not built yet" note.
  await expect(page.getByRole('heading', { name: modelName })).toBeVisible();
  const capabilityMapLink = page.getByRole('link', { name: 'Capability map →' });
  const landscapeLink = page.getByRole('link', { name: 'Landscape →' });
  const versionsLink = page.getByRole('link', { name: 'Versions →' });
  await expect(capabilityMapLink).toBeVisible();
  await expect(landscapeLink).toBeVisible();
  await expect(versionsLink).toBeVisible();

  await landscapeLink.click();
  await expect(page).toHaveURL(/\/landscape$/);
});
