/**
 * S1 item 11a (docs/prompts/atlas-prompt-pack.md, issue #117): "Actors:
 * `isExternal` (default false) and `externalOrganisation` (text); subtype
 * gains `organisation`. Landscape and context render external actors
 * outside the enterprise boundary; `owns` from an external actor only
 * with role service; Assurance finding: flows to/from external
 * organisations without data classification."
 *
 * The golden path: an external organisation actor ("Ofgem") uses a
 * system ("submits RIIO returns to") — it renders outside the boundary
 * on both the landscape and the Context view, and drives the new
 * "external organisations with access" Assurance row.
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('an external organisation actor using a system renders outside the boundary and drives the Assurance row', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'externalactor', 'Reporting System');
  const { signedIn, orgSlug, modelSlug, modelId, main, seedSourceId, systemId } = fixture;

  // The subtype/isExternal/externalOrganisation trio isn't collectible in
  // one step through the generic "+ Add actor" create-then-edit flow —
  // seeded directly, same as other tests here seed setup that isn't the
  // behaviour under test (attributeSchema.test.ts already covers the
  // fields themselves).
  const actorId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed an external organisation actor',
    body: null,
    deltas: [{ kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Ofgem', parentId: null, attributes: { subtype: 'organisation', isExternal: true, externalOrganisation: 'Ofgem' }, sourceId: seedSourceId, confidence: 1 }],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding external actor: ${seedResult.message}`);

  // The `uses` edge itself is added through the real UI, from the actor's
  // own page (the golden path's own direction: an actor's outbound "+ Add
  // uses" — S1 item 11a's own new relationship-type-rules rows are what
  // make this control exist at all; before this item, an actor's only
  // relationship slot was "+ Add owns").
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${actorId}`);
  await expect(page.getByRole('heading', { name: 'Ofgem' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add uses' }).click();
  await page.getByPlaceholder('Search…').fill('Reporting System');
  await page.getByRole('button', { name: /Reporting System/ }).click();
  await page.getByPlaceholder('e.g. reads customer records from').fill('submits RIIO returns to');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Skip — link directly' }).click();
  await expect(page.getByRole('link', { name: /Reporting System/ })).toBeVisible();

  // Landscape mobile list (narrow viewport, real DOM group unlike the
  // canvas): Ofgem sits in the External group, not the leading Actors one.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const externalGroup = page.getByRole('button', { name: /^External\b/ });
  await expect(externalGroup).toBeVisible();
  await externalGroup.click();
  await expect(page.getByText('Ofgem', { exact: true })).toBeVisible();
  // Never in the leading Actors group either, if that group renders at all
  // (it may not, with no internal actor seeded here).
  const actorsGroup = page.getByRole('button', { name: /^Actors\b/ });
  if (await actorsGroup.count() > 0) {
    await actorsGroup.click();
    await expect(page.getByText('Ofgem', { exact: true })).toHaveCount(0);
  }

  // Context view: V1 moved the desktop view onto a canvas
  // (ContextDiagramCanvas.tsx) — Ofgem renders outside the dotted
  // enterprise boundary there, but a canvas's own drawn text isn't
  // DOM-queryable (UI-principles §8.7's own "element page is the
  // accessible view" stance), so this checks the mobile list instead:
  // Ofgem shows under "People" (V1's own direction-based grouping, not
  // internal/external), flagged with the same "external" badge the hub's
  // own header uses, with the real verb phrase, not a generic fallback.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${systemId}`);
  await page.getByRole('button', { name: /^People/ }).click();
  await expect(page.getByText('Ofgem')).toBeVisible();
  await expect(page.getByText('external', { exact: true })).toBeVisible();
  await expect(page.getByText(/submits RIIO returns to/)).toBeVisible();

  // The architect door's own new Assurance row.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('1 external organisation with access')).toBeVisible();

  // The shared "View all" page lists it too.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/external-interfaces`);
  await expect(page.getByRole('heading', { name: 'External organisations with access' })).toBeVisible();
  await expect(page.getByText('Ofgem uses Reporting System')).toBeVisible();
});

test('owns from an external actor is rejected unless role is service (C20)', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'externalowns', 'Billing Platform');
  const { signedIn, orgSlug, modelSlug, modelId, main, seedSourceId, systemId } = fixture;

  const actorId = randomUUID();
  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed an external organisation actor',
    body: null,
    deltas: [{ kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Acme Support', parentId: null, attributes: { subtype: 'organisation', isExternal: true, externalOrganisation: 'Acme Ltd' }, sourceId: seedSourceId, confidence: 1 }],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding external actor: ${seedResult.message}`);

  // From the system's own page: an inbound "+ Add owned by", picking the
  // external actor, then answering the staged role prompt with "Business"
  // — a role only an internal owner may legally hold.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await page.getByRole('button', { name: '+ Add owned by' }).click();
  await page.getByPlaceholder('Search…').fill('Acme Support');
  await page.getByRole('button', { name: /Acme Support/ }).click();
  await page.getByRole('button', { name: 'Business' }).click();

  await expect(page.getByText(/C20/)).toBeVisible();
  // Never actually created — the owner never shows up on the page.
  await expect(page.getByText('Acme Support', { exact: true })).toHaveCount(0);
});
