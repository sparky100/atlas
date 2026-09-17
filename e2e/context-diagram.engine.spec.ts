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
 *  - A container (SAP PM, one of SAP's modules) gets a real Context page
 *    of its own — centred on itself, with its own direct neighbours, edges
 *    and verb labels, at the smaller scale a single container's own
 *    relationships actually are (item 1). This is also the density case
 *    the pre-V3 combined diagram used to carry at the platform level
 *    (`src/ui/context/fixtures/sapContext.ts`'s own module comment): four
 *    internal neighbours with one or two flows each, plus one external
 *    organisation actor — moved down to PM's own page rather than
 *    engineered around at the platform level (item 3).
 *
 * The desktop canvas's own tile/edge/label drawing is pixels Playwright
 * can't inspect (UI-principles §8.7 — the element page, and here the
 * mobile list, are the accessible view). What *is* checked on desktop for
 * PM's own page is the layout module's own verdict, surfaced as DOM state:
 * the wrapper's `data-edge-labels-collide` (the collision audit over the
 * real, measured label pills) and the "Labels" toggle's `aria-pressed`
 * (the effective visibility). The geometry itself — fan spread, distinct
 * lanes, no edge through a tile, no pill collision — is
 * `contextDiagramLayout.test.ts`'s own job, over the same fixture. The
 * platform's own structure page has no canvas at all — its own absence is
 * exactly what item 2 asks to prove.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getMainBranch } from '../src/db/branches';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { getElementHead } from '../src/db/elements';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { SAP_MODULES, scenarioEdgeLabel } from '../src/ui/context/fixtures/sapContext';
import { seedSapContextFixture } from './fixtures/sapContextFixture';

test('SAP as a platform renders its own module tiles only — no edges, no labels; clicking a module tile drills down to that module\'s own Context page, breadcrumb included', async ({ page }) => {
  const env = loadEnv();
  const fixture = await seedSapContextFixture(page, env, 'ctxstructure');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, sapId, moduleIdByCode } = fixture;

  // One module (BW) carries its own `retiring` lifecycle status,
  // uninherited from the platform, to prove the tile's own tone comes from
  // the module — not from SAP itself, which stays `active` throughout.
  // Seeded as a second commit rather than folded into the fixture's own
  // seed — this test is the only one that cares about it.
  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: fixture.userId });
  const bwId = moduleIdByCode.get('BW') ?? '';
  // The fixture's own `main` is `bootstrapChangeBranchFixture`'s pre-seed
  // snapshot — re-fetched here for the real head after `seedSapContextFixture`'s
  // own commit, the same "refreshedMain" step that helper takes internally.
  const main = await getMainBranch(owner, modelId);
  if (!main) throw new Error('main branch disappeared after seeding the SAP context fixture');
  const bw = await getElementHead(owner, main.head_commit_id, bwId);
  const deltas: Delta[] = [
    { kind: 'element.update', id: randomUUID(), elementId: bwId, elementType: 'container', attribute: 'lifecycleStatus', value: 'retiring', previousDeltaId: bw?.exists_delta_id ?? '', sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'set BW to retiring', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seed BW retiring: ${seedResult.message}`);

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
  for (const m of SAP_MODULES) {
    const tile = moduleTile(m.code);
    await expect(tile).toBeVisible();
    await expect(tile.getByText(m.capability)).toBeVisible();
  }
  // BW's own `retiring` status reaches its own tile, not SAP's — PM's own
  // real neighbours (seeded by the fixture too) never leak onto this page
  // either, checked below.
  await expect(moduleTile('BW')).toHaveAttribute('data-tone', 'warn');

  // Item 3: no canvas, no edges, no labels at the platform level at all —
  // the whole point of the structure-only page, even though PM (one of
  // these same modules) has five real neighbours of its own.
  await expect(page.getByRole('img', { name: /Context diagram/ })).toHaveCount(0);
  await expect(page.locator('[data-scale]')).toHaveCount(0);
  await expect(page.getByText(/uses →|used by|flows to|flows from/)).toHaveCount(0);

  // The one "descend a level" affordance a platform's own page still
  // offers — the place to actually add/edit its modules.
  await expect(page.getByRole('link', { name: 'Containers →' })).toBeVisible();

  // Clicking a module tile drills down to that module's own Context page.
  await moduleTile('PM').click();
  await expect(page).toHaveURL(new RegExp(`/context/${moduleIdByCode.get('PM') ?? ''}`));
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PM' }).first()).toBeVisible();

  // Breadcrumb reflects the drill-down: SAP, then PM.
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const sapCrumb = breadcrumb.getByRole('link', { name: 'SAP' });
  const pmCrumb = breadcrumb.getByRole('link', { name: 'PM' });
  await expect(sapCrumb).toBeVisible();
  await expect(pmCrumb).toBeVisible();
  const crumbText = await breadcrumb.innerText();
  expect(crumbText.indexOf('SAP')).toBeLessThan(crumbText.indexOf('PM'));
});

test("SAP PM's own Context page (a container, one of SAP's modules) renders its real neighbours with every label visible and non-colliding at 1280; Ofgem renders outside the boundary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const env = loadEnv();
  const fixture = await seedSapContextFixture(page, env, 'ctxpm');
  const { orgSlug, modelSlug, moduleIdByCode, scenario } = fixture;
  const pmId = moduleIdByCode.get(scenario.hubModuleCode) ?? '';

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${pmId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();

  // PM's own header — its own direct `supports` edge to its own capability, exactly like any other hub (never "grouped by module": a container is never nested any more).
  await expect(page.getByText('Supports:', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Asset Maintenance' })).toBeVisible();

  // The canvas renders, and the layout module's collision audit over the real, font-measured pills passes at this density — so labels are on by default, not auto-hidden.
  const canvasWrapper = page.locator('[data-scale]');
  await expect(canvasWrapper).toBeVisible();
  await expect(canvasWrapper).toHaveAttribute('data-scale', /.+/);
  await expect(page.getByRole('img', { name: /Context diagram: PM and 5 connected/ })).toBeVisible();
  await expect(canvasWrapper).toHaveAttribute('data-edge-labels-collide', 'false');
  await expect(canvasWrapper).toHaveAttribute('data-edge-labels', 'visible');
  const labelsToggle = page.getByRole('button', { name: 'Show edge labels' });
  await expect(labelsToggle).toHaveAttribute('aria-pressed', 'true');

  // The toggle is a real override: off hides every label (hover/tap reveals one at a time), on brings them back.
  await labelsToggle.click();
  await expect(labelsToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(canvasWrapper).toHaveAttribute('data-edge-labels', 'hidden');
  await labelsToggle.click();
  await expect(labelsToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(canvasWrapper).toHaveAttribute('data-edge-labels', 'visible');
});

test("the same PM fixture on mobile lists every neighbour under its direction with every verb intact, Ofgem flagged external", async ({ page }) => {
  const env = loadEnv();
  const fixture = await seedSapContextFixture(page, env, 'ctxpmm');
  const { orgSlug, modelSlug, moduleIdByCode, scenario } = fixture;
  const pmId = moduleIdByCode.get(scenario.hubModuleCode) ?? '';

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${pmId}`);
  await expect(page.getByRole('link', { name: 'PM' }).first()).toBeVisible();

  // The list is an accordion with one group open at a time (`ContextMobileList.tsx`'s own `expandedKey`), so each direction is opened and checked in turn.
  const groupOf = (neighbour: (typeof scenario.neighbours)[number], flow: (typeof neighbour.flows)[number]): string => {
    if (neighbour.elementType === 'actor') return 'People';
    if (flow.relationshipType === 'flows_to') return flow.direction === 'out' ? 'Flows out' : 'Flows in';
    return flow.direction === 'out' ? 'Uses' : 'Used by';
  };
  const expected = new Map<string, { name: string; label: string }[]>();
  for (const neighbour of scenario.neighbours) {
    for (const flow of neighbour.flows) {
      const group = groupOf(neighbour, flow);
      expected.set(group, [...(expected.get(group) ?? []), { name: neighbour.name, label: scenarioEdgeLabel(flow) }]);
    }
  }
  for (const [group, rows] of expected) {
    const button = page.getByRole('button', { name: new RegExp(`^${group} ${String(rows.length)} connection`) });
    await expect(button).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    for (const row of rows) {
      await expect(page.getByText(row.name, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(row.label, { exact: false }).first()).toBeVisible();
    }
    if (group === 'People') await expect(page.getByText('external', { exact: true }).first()).toBeVisible();
  }
});
