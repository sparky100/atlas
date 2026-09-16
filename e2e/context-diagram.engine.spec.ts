/**
 * V3 ("container context pages, and platform context simplified to
 * structure-only") replaces V1's own combined "platform diagram with
 * nested modules and neighbours" scenario with two clean, separate cases —
 * item 3's own "all neighbour/flow rendering now only ever handles one
 * system or one container's own relationships at a time":
 *
 *  - A platform (SAP, with modules) gets a structure-only page: its own
 *    module tiles, no external neighbours, no drawn edges, no labels at
 *    all (item 2). Each module tile links to that module's own Context
 *    page (item 1).
 *  - A container (SAP FI, one of SAP's modules) gets a real Context page
 *    of its own — centred on itself, with its own direct neighbours, edges
 *    and verb labels, at the smaller scale a single container's own
 *    relationships actually are (item 1).
 *
 * The desktop canvas's own tile/edge drawing is pixels Playwright can't
 * inspect (UI-principles §8.7 — the element page, and here the mobile
 * list, are the accessible view) — same limitation this file's own V1
 * predecessor already noted. Verified two ways instead: the mobile list (a
 * real DOM group, at <768px) for the actual content, and a
 * `data-scale`/`data-tx`/`data-ty`-bearing canvas wrapper (same
 * `LandscapeCanvas.tsx` convention `ContextDiagramCanvas.tsx` reuses) to
 * confirm the desktop canvas renders at all, without needing to read its
 * pixels. The platform's own structure page has no canvas at all — its own
 * absence is exactly what item 2 asks to prove.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('SAP as a platform renders its own module tiles only — no edges, no labels; clicking a module tile drills down to that module\'s own Context page, breadcrumb included', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'ctxstructure', 'SAP');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: sapId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });

  // The user's own fixture: SAP as the platform, 8 modules — the classic
  // SAP module set, same flavour as every other SAP-shaped fixture already
  // in this suite (FI/PM). One module (BW) carries its own `retiring`
  // lifecycle status, uninherited from the platform, to prove the tile's
  // own tone comes from the module — not from SAP itself, which stays
  // `active` throughout.
  const modules = [
    { code: 'FI', capability: 'Finance' },
    { code: 'PM', capability: 'Asset Management' },
    { code: 'MM', capability: 'Materials Management' },
    { code: 'CO', capability: 'Controlling' },
    { code: 'PS', capability: 'Project Systems' },
    { code: 'SD', capability: 'Sales and Distribution' },
    { code: 'HR', capability: 'Human Resources' },
    { code: 'BW', capability: 'Reporting' },
  ].map((m) => ({ ...m, moduleId: randomUUID(), capabilityId: randomUUID() }));

  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
    ...modules.flatMap((m): Delta[] => [
      {
        kind: 'element.create',
        id: randomUUID(),
        elementId: m.moduleId,
        elementType: 'container',
        name: m.code,
        parentId: sapId,
        attributes: m.code === 'BW' ? { isExternal: false, lifecycleStatus: 'retiring' } : { isExternal: false },
        sourceId: source.id,
        confidence: 1,
      },
      { kind: 'element.create', id: randomUUID(), elementId: m.capabilityId, elementType: 'capability', name: m.capability, parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: m.moduleId, toElementId: m.capabilityId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    ]),
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed SAP as a platform with 8 modules', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed platform-structure fixture: ${seedResult.message}`);

  const fi = modules.find((m) => m.code === 'FI');
  if (!fi) throw new Error('expected an FI module in the fixture');
  const bw = modules.find((m) => m.code === 'BW');
  if (!bw) throw new Error('expected a BW module in the fixture');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SAP' }).first()).toBeVisible();

  // Structure only: every one of the 8 modules is a tile, each named and
  // carrying its own capability chip. Anchored (`^code\b`) rather than a
  // plain substring, since a two-letter module code can otherwise land
  // inside an unrelated capability name (e.g. "CO" inside "Controlling").
  function moduleTile(code: string) {
    return page.getByRole('listitem', { name: new RegExp(`^${code}\\b`) });
  }
  for (const m of modules) {
    const tile = moduleTile(m.code);
    await expect(tile).toBeVisible();
    await expect(tile.getByText(m.capability)).toBeVisible();
  }
  // BW's own `retiring` status reaches its own tile, not SAP's.
  await expect(moduleTile(bw.code)).toHaveAttribute('data-tone', 'warn');

  // Item 3: no canvas, no edges, no labels at the platform level at all —
  // the whole point of the structure-only page.
  await expect(page.getByRole('img', { name: /Context diagram/ })).toHaveCount(0);
  await expect(page.locator('[data-scale]')).toHaveCount(0);
  await expect(page.getByText(/uses →|used by|flows to|flows from/)).toHaveCount(0);

  // The one "descend a level" affordance a platform's own page still
  // offers — the place to actually add/edit its modules.
  await expect(page.getByRole('link', { name: 'Containers →' })).toBeVisible();

  // Clicking a module tile drills down to that module's own Context page.
  await moduleTile(fi.code).click();
  await expect(page).toHaveURL(new RegExp(`/context/${fi.moduleId}`));
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'FI' }).first()).toBeVisible();

  // Breadcrumb reflects the drill-down: SAP, then FI.
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const sapCrumb = breadcrumb.getByRole('link', { name: 'SAP' });
  const fiCrumb = breadcrumb.getByRole('link', { name: 'FI' });
  await expect(sapCrumb).toBeVisible();
  await expect(fiCrumb).toBeVisible();
  const crumbBox = await breadcrumb.innerText();
  expect(crumbBox.indexOf('SAP')).toBeLessThan(crumbBox.indexOf('FI'));
});

/**
 * The user's own fixture for item 1: "SAP FI as a container with its own
 * context page showing its real neighbours ... with proper label routing
 * at that smaller scale." A container's own Context page renders exactly
 * like a system's — its own direct neighbours, mixed `uses`/`flows_to`,
 * at the bounded scale one container's own relationships actually are
 * (never a platform's worth of modules crowding the same diagram any
 * more).
 */
test("a container's own Context page (SAP FI) shows its real neighbours with correct edges and labels", async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'ctxcontainer', 'SAP');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: sapId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const fiId = randomUUID();
  const graphicalDesignToolId = randomUUID();
  const crmId = randomUUID();
  const escomsId = randomUUID();
  const powerOnId = randomUUID();
  const fieldServiceId = randomUUID();

  function neighbour(id: string, name: string): Delta {
    return { kind: 'element.create', id: randomUUID(), elementId: id, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 };
  }

  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: sapId, elementType: 'system', attribute: 'kind', value: 'platform', previousDeltaId: fixture.createDeltaId, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: fiId, elementType: 'container', name: 'FI', parentId: sapId, attributes: { isExternal: false }, sourceId: source.id, confidence: 1 },
    neighbour(graphicalDesignToolId, 'Graphical Design Tool'),
    neighbour(crmId, 'CRM'),
    neighbour(escomsId, 'ESCOMS'),
    neighbour(powerOnId, 'PowerON'),
    neighbour(fieldServiceId, 'Field Service'),
    // FI's own real neighbours — every one of these names FI directly, not
    // SAP: a module's own neighbours live only on its own page now.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: graphicalDesignToolId, toElementId: fiId, attributes: { description: 'sends network build cost estimates to' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: crmId, toElementId: fiId, attributes: { description: 'pulls invoice status from' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: escomsId, toElementId: fiId, attributes: { description: 'reconciles connection charges with' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: powerOnId, toElementId: fiId, attributes: { description: 'sends outage restoration costs to' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: fieldServiceId, toElementId: fiId, attributes: { description: 'submits job costs to' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed SAP FI with its own five real neighbours', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed container-context fixture: ${seedResult.message}`);

  // Desktop: a real diagram (with the same transform-exposing wrapper
  // attributes LandscapeCanvas.tsx already uses), just this one container
  // and its own neighbours — no module nesting or platform tile at all.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${fiId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'FI' }).first()).toBeVisible();
  const canvasWrapper = page.locator('[data-scale]');
  await expect(canvasWrapper).toBeVisible();
  await expect(canvasWrapper).toHaveAttribute('data-scale', /.+/);
  await expect(page.getByRole('img', { name: /Context diagram/ })).toBeVisible();

  // Breadcrumb: SAP (the platform parent), then FI.
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumb.getByRole('link', { name: 'SAP' })).toBeVisible();
  await expect(breadcrumb.getByRole('link', { name: 'FI' })).toBeVisible();

  // Mobile (<768px): the same content as a list grouped by direction — all
  // five real neighbours, each with its own full, untruncated verb, split
  // correctly between "Uses" (an edge FI is the `to` side of, from the
  // neighbour) and "Flows in".
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${fiId}`);
  await expect(page.getByRole('link', { name: 'FI' }).first()).toBeVisible();

  const flowsInGroup = page.getByRole('button', { name: /^Flows in/ });
  await expect(flowsInGroup).toBeVisible();
  await flowsInGroup.click();
  await expect(page.getByText('Graphical Design Tool', { exact: true })).toBeVisible();
  await expect(page.getByText('⇢ sends network build cost estimates to')).toBeVisible();
  await expect(page.getByText('PowerON', { exact: true })).toBeVisible();
  await expect(page.getByText('⇢ sends outage restoration costs to')).toBeVisible();

  const usedByGroup = page.getByRole('button', { name: /^Used by/ });
  await expect(usedByGroup).toBeVisible();
  await usedByGroup.click();
  await expect(page.getByText('CRM', { exact: true })).toBeVisible();
  await expect(page.getByText('← pulls invoice status from')).toBeVisible();
  await expect(page.getByText('ESCOMS', { exact: true })).toBeVisible();
  await expect(page.getByText('← reconciles connection charges with')).toBeVisible();
  await expect(page.getByText('Field Service', { exact: true })).toBeVisible();
  await expect(page.getByText('← submits job costs to')).toBeVisible();
});
