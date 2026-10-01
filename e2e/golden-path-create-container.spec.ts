/**
 * "Create a new element from Home search, and from the Elements page too" —
 * a container is the one type that needs its own extra step
 * (`HomeSearch.tsx`'s own `showPlatformPicker`: ADR-001, a container's
 * `parentId` can never be null), so this is the flow most worth covering
 * end to end. Click-only from Home (S2's own rule) — no seeding beyond
 * org/user, no `page.goto` after the first, no URL construction.
 *
 * Not executed in this sandbox — no Docker/local Supabase route (every
 * other `golden-path-*.spec.ts` in this session carries the same caveat).
 */
import { expect, test } from '@playwright/test';
import { addContainerFromHome, addSystemFromHome, goToModelHome, signUpCreateOrgAndModel } from './fixtures/goldenPath';

test('create a container as a module of an existing platform, from Home search and from the Elements page', async ({ page }) => {
  await signUpCreateOrgAndModel(page, 'goldenpath-createcontainer');

  // The platform this flow's modules belong to — any live system is a
  // legal parent (no `kind: 'platform'` restriction, same reasoning
  // `ConvertToModuleAction.tsx`'s own doc comment gives), so a plain
  // system is enough here.
  await addSystemFromHome(page, { name: 'SAP', description: 'The enterprise resource planning platform.' });

  // From Home search: type a new name, switch the create-type dropdown to
  // "container", then pick the platform once asked.
  await goToModelHome(page);
  await addContainerFromHome(page, 'FI', 'SAP');
  await expect(page.getByRole('heading', { name: 'FI' })).toBeVisible();
  // The breadcrumb's own "container" case names the parent platform first
  // (`elementBreadcrumbSegments.ts`) — proof the module actually landed
  // under SAP, not as a second top-level element.
  await expect(page.getByRole('link', { name: 'SAP', exact: true })).toBeVisible();

  // The same search-first create control, reused verbatim on the Elements
  // page (`ElementsPage.tsx`'s own `HomeSearch` wiring) — not a second,
  // bespoke "+ Add" implementation.
  await goToModelHome(page);
  await page.getByRole('link', { name: 'Browse all elements →' }).click();
  await expect(page.getByRole('heading', { name: 'Elements' })).toBeVisible();
  await addContainerFromHome(page, 'RE', 'SAP');
  await expect(page.getByRole('heading', { name: 'RE', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SAP', exact: true })).toBeVisible();
});
