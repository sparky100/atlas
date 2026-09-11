/**
 * Prompt 7k item 1: criticality and hosting. The prompt pack's own
 * combined Playwright line: "add criticality and hosting to a system and
 * see the colour-by." Also covers the element page showing both
 * attributes with provenance (`AttributesTable`'s generic enum rendering —
 * no bespoke component needed, `attributeSchema.ts`'s own entries are
 * enough) and the landscape's colour-by select actually changing what the
 * canvas shows (surfaced via the hover tooltip — a canvas fill isn't
 * something Playwright can query as DOM, `e2e/landscape-hollow-marker-and-filter.spec.ts`'s
 * own module comment makes the same point).
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { expect, test } from '@playwright/test';
import { loadEnv } from '../src/db/env';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';
import type { ElementsHeadRow } from '../src/contracts/rows';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('setting a system\'s criticality and hosting model shows both with provenance, and drives the landscape colour-by', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'critichost', 'Payments Gateway');
  const { orgSlug, modelSlug, systemId } = fixture;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/e/${systemId}`);
  await expect(page.getByRole('heading', { name: 'Payments Gateway' })).toBeVisible();

  await page.getByRole('button', { name: '✎ Edit' }).click();
  await page.getByLabel('Criticality').selectOption('critical');
  await page.getByLabel('Hosting model').selectOption('saas');
  await page.getByLabel('Hosting provider').fill('Acme Cloud (eu-west-1)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '✎ Edit' })).toBeVisible();

  // The element page shows both new attributes with provenance — no
  // bespoke component needed, the generic AttributesTable/FactBadge
  // machinery already renders every attributeSchema.ts-declared field.
  await expect(page.getByText('critical').first()).toBeVisible();
  await expect(page.getByText('saas').first()).toBeVisible();
  await expect(page.getByText('Acme Cloud (eu-west-1)').first()).toBeVisible();

  // The landscape's colour-by: "None" by default, switching to
  // "Criticality" tints the tile and surfaces the value in the hover
  // tooltip (the tile fill itself isn't something Playwright can query as
  // DOM — same reasoning e2e/landscape-hollow-marker-and-filter.spec.ts's
  // own module comment gives for its own marker-geometry approach).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });

  const colourBySelect = page.getByLabel('Colour by');
  await expect(colourBySelect).toHaveValue('none');
  await colourBySelect.selectOption('metric:criticality');

  const systemRow: ElementsHeadRow = {
    element_id: systemId,
    element_type: 'system',
    name: 'Payments Gateway',
    parent_id: null,
    attributes: { lifecycleStatus: 'active', isExternal: false, criticality: 'critical', hostingModel: 'saas' },
    exists_delta_id: 'irrelevant-for-layout',
  };
  const layout = computeLandscapeLayout([systemRow], [], new Map());
  const node = layout.nodes.find((n) => n.elementId === systemId);
  if (!node) throw new Error('computeLandscapeLayout did not place the seeded system');
  const centreWorldX = node.x + NODE_WIDTH / 2;
  const centreWorldY = node.y + NODE_HEIGHT / 2;
  const wrapper = page.locator('[data-scale]');

  await expect(async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    const scale = Number(await wrapper.getAttribute('data-scale'));
    const tx = Number(await wrapper.getAttribute('data-tx'));
    const ty = Number(await wrapper.getAttribute('data-ty'));
    await page.mouse.move(box.x + centreWorldX * scale + tx, box.y + centreWorldY * scale + ty);
    await expect(page.getByText('Payments Gateway — critical')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Switching to "Hosting model" changes what the tooltip shows — proof
  // the two modes are genuinely different reads of the system, not the
  // same fixed label regardless of mode.
  await colourBySelect.selectOption('metric:hostingModel');
  await expect(async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    const scale = Number(await wrapper.getAttribute('data-scale'));
    const tx = Number(await wrapper.getAttribute('data-tx'));
    const ty = Number(await wrapper.getAttribute('data-ty'));
    await page.mouse.move(box.x + centreWorldX * scale + tx, box.y + centreWorldY * scale + ty + 1);
    await page.mouse.move(box.x + centreWorldX * scale + tx, box.y + centreWorldY * scale + ty);
    await expect(page.getByText('Payments Gateway — SaaS')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});
