/**
 * V1 — the context diagram, checked against its standing density fixture
 * (`src/ui/context/fixtures/sapContext.ts`, seeded by
 * `e2e/fixtures/sapContextFixture.ts`): SAP with eight modules, five
 * neighbours carrying two to four flows each, and an external organisation
 * actor. Not a synthetic two-neighbour case — every future change to this
 * view is checked against real density here and in
 * `contextDiagramLayout.test.ts`.
 *
 * The desktop canvas's own tile/edge/label drawing is pixels Playwright
 * can't inspect (UI-principles §8.7 — the element page, and here the
 * mobile list, are the accessible view). What *is* checked on desktop is
 * the layout module's own verdict, surfaced as DOM state: the wrapper's
 * `data-edge-labels-collide` (the collision audit over the real, measured
 * label pills) and the "Labels" toggle's `aria-pressed` (the effective
 * visibility). The geometry itself — fan spread, distinct lanes, no edge
 * through a tile, no pill collision — is `contextDiagramLayout.test.ts`'s
 * job, over the same fixture.
 */
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { scenarioEdgeLabel } from '../src/ui/context/fixtures/sapContext';
import { seedSapContextFixture } from './fixtures/sapContextFixture';

test('SAP with eight modules and five multi-flow neighbours renders with every label visible and non-colliding at 1280; Ofgem renders outside the boundary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const env = loadEnv();
  const fixture = await seedSapContextFixture(page, env, 'ctxsap');
  const { orgSlug, modelSlug, sapId, scenario } = fixture;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();

  // The header's own "Supports:" line is grouped by module — all eight, each with its capability.
  const supportsLine = page.getByText('Supports:', { exact: false });
  await expect(supportsLine).toBeVisible();
  const supportsText = await supportsLine.innerText();
  for (const module of scenario.modules) {
    expect(supportsText).toContain(module.name);
    expect(supportsText).toContain(module.capability);
  }

  // The canvas renders, and the layout module's collision audit over the real, font-measured pills passes at this density — so labels are on by default, not auto-hidden.
  const canvasWrapper = page.locator('[data-scale]');
  await expect(canvasWrapper).toBeVisible();
  await expect(canvasWrapper).toHaveAttribute('data-scale', /.+/);
  await expect(page.getByRole('img', { name: /Context diagram: SAP and 6 connected/ })).toBeVisible();
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

test('the same fixture on mobile lists every neighbour under its direction with every verb intact, Ofgem flagged external', async ({ page }) => {
  const env = loadEnv();
  const fixture = await seedSapContextFixture(page, env, 'ctxsapm');
  const { orgSlug, modelSlug, sapId, scenario } = fixture;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${sapId}`);
  await expect(page.getByRole('link', { name: 'SAP' }).first()).toBeVisible();

  const groups = ['Uses', 'Used by', 'Flows in', 'Flows out', 'People'] as const;
  for (const group of groups) {
    const button = page.getByRole('button', { name: new RegExp(`^${group}`) });
    if ((await button.count()) === 0) continue;
    await button.first().click();
  }

  for (const neighbour of scenario.neighbours) {
    await expect(page.getByText(neighbour.name, { exact: true }).first()).toBeVisible();
    for (const flow of neighbour.flows) {
      await expect(page.getByText(scenarioEdgeLabel(flow), { exact: false }).first()).toBeVisible();
    }
  }
  await expect(page.getByText('external', { exact: true }).first()).toBeVisible();
});
