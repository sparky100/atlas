/**
 * Layout consistency pass (Level-1 headers, L2 tile density, column
 * widths): three assertions the prompt named explicitly —
 *
 * 1. Every L1 header's own title sits on the same baseline, at a fixed
 *    height, regardless of name length or how much content is under it —
 *    `CapabilityMapView.module.css`'s own `.columnHeader`/`.columnName`
 *    comment has the design (single-line, ellipsis-truncated title,
 *    guaranteed-equal row height by construction). Checked at 1280 and
 *    1920 — both inside the 5-column tier (`CapabilityMapView.module.css`'s
 *    own breakpoint comment), so five L1s sit in one row at either width
 *    and their title links' own bounding boxes are directly comparable.
 * 2. Every populated L2 tile is the same height, whatever its own content
 *    (a tone chip or not, supporting systems or "no systems", an expand
 *    toggle or not) — `CapabilityTile.tsx`'s own "reserved secondary row"
 *    design (Sprint U4-2b item 3, extended by this pass to cover the
 *    whole secondary row, not just the chip).
 * 3. Column order follows the starter map's own convention (`order`
 *    attribute, `layout.ts`'s `compareCapabilities`) and every column in
 *    a `grid-template-columns: repeat(N, minmax(0, 1fr))` grid is the
 *    same width by construction — a wrapped second row reuses the exact
 *    same column tracks, not a fresh independent row of its own widths.
 *
 * Same "needs a real Supabase" limitation as every other Playwright test
 * in this repo (playwright.config.ts's own module comment).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

const LONGEST_L1_NAME = 'Regulatory Compliance & Price-Control Reporting'; // Same real starter-map name capability-map-text-overflow.engine.spec.ts uses — deliberately the longest real L1 name, to actually exercise truncation rather than a name that happens to fit.
const L1_NAMES = ['Estates', 'Digital & Technology', LONGEST_L1_NAME, 'Customer Contact', 'Finance'] as const;

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** `top`/`height` of each named link's own bounding box, in the order given — throws if any is missing (every name here is expected to always be visible at the widths this test uses). */
async function boxes(page: Page, names: readonly string[]): Promise<{ top: number; height: number }[]> {
  const result: { top: number; height: number }[] = [];
  for (const name of names) {
    const box = await page.getByRole('link', { name, exact: true }).boundingBox();
    if (!box) throw new Error(`no bounding box for link "${name}" — not visible?`);
    result.push({ top: box.y, height: box.height });
  }
  return result;
}

/** Every value in `values` within `tolerancePx` of the first — real layout, not exact floating-point equality (sub-pixel rendering can differ by a fraction of a pixel between elements that are logically the same height). */
function expectAllClose(values: readonly number[], label: string, tolerancePx = 1): void {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(`expectAllClose(${label}): no values given`);
  for (const value of rest) {
    expect(Math.abs(value - first), `${label}: expected ${String(value)} to be within ${String(tolerancePx)}px of ${String(first)} — got [${values.join(', ')}]`).toBeLessThanOrEqual(tolerancePx);
  }
}

test('capability map layout consistency: L1 header baselines, L2 tile heights, column order and width', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-consistency-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-layout-consistency fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-layout-consistency fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-consistency-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Layout Consistency Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-consistency-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Layout Consistency Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Five L1s, deliberately unlike each other, so an equal-height/baseline
  // result actually demonstrates the layout is doing the work rather than
  // every column just happening to have the same content:
  //  - "Estates": short name, no L2 children at all (an empty column).
  //  - "Digital & Technology": one L2 with zero supporting systems
  //    ("no systems" fallback).
  //  - the longest real L1 name (truncates) — two L2s, one with a
  //    supporting system (gets a colour-by tone once Coverage is on),
  //    one without.
  //  - "Customer Contact": one L2 with a supporting system *and* an L3
  //    child (its own expand toggle in the secondary row).
  //  - "Finance": one L2 with two supporting systems, no L3.
  const estatesId = randomUUID();
  const digitalId = randomUUID();
  const serviceDeskId = randomUUID();
  const regComplianceId = randomUUID();
  const meteringId = randomUUID();
  const billingId = randomUUID();
  const customerContactId = randomUUID();
  const complaintsId = randomUUID();
  const escalationsId = randomUUID(); // L3, under Complaints
  const financeId = randomUUID();
  const payrollId = randomUUID();

  const meteringSystemId = randomUUID();
  const complaintsSystemId = randomUUID();
  const payrollSystemAId = randomUUID();
  const payrollSystemBId = randomUUID();

  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: estatesId, elementType: 'capability', name: 'Estates', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },

    { kind: 'element.create', id: randomUUID(), elementId: digitalId, elementType: 'capability', name: 'Digital & Technology', parentId: null, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: serviceDeskId, elementType: 'capability', name: 'Service Desk', parentId: digitalId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },

    { kind: 'element.create', id: randomUUID(), elementId: regComplianceId, elementType: 'capability', name: LONGEST_L1_NAME, parentId: null, attributes: { order: 30 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: meteringId, elementType: 'capability', name: 'Metering', parentId: regComplianceId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: billingId, elementType: 'capability', name: 'Billing', parentId: regComplianceId, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: meteringSystemId, elementType: 'system', name: 'Meter Data Hub', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: meteringSystemId, toElementId: meteringId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },

    { kind: 'element.create', id: randomUUID(), elementId: customerContactId, elementType: 'capability', name: 'Customer Contact', parentId: null, attributes: { order: 40 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: complaintsId, elementType: 'capability', name: 'Complaints', parentId: customerContactId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: escalationsId, elementType: 'capability', name: 'Escalations', parentId: complaintsId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: complaintsSystemId, elementType: 'system', name: 'Case Manager', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: complaintsSystemId, toElementId: complaintsId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },

    { kind: 'element.create', id: randomUUID(), elementId: financeId, elementType: 'capability', name: 'Finance', parentId: null, attributes: { order: 50 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: payrollId, elementType: 'capability', name: 'Payroll', parentId: financeId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: payrollSystemAId, elementType: 'system', name: 'Payroll System A', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: payrollSystemBId, elementType: 'system', name: 'Payroll System B', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: payrollSystemAId, toElementId: payrollId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: payrollSystemBId, toElementId: payrollId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed five deliberately-unlike L1 columns for a layout consistency check',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-layout-consistency fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Estates')).toBeVisible();
  // Coverage colour-by, so Metering (has a supporting system) gets a real
  // tone chip while Billing (none) gets the hidden placeholder instead —
  // exactly the "chip vs. no chip" contrast item 2 is checking holds equal
  // height either way.
  await page.getByLabel('Colour by').selectOption({ label: 'Coverage (supporting-system count)' });

  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 1200 });
    expect(await hasHorizontalScroll(page)).toBe(false);

    // (1) Every L1 header's own title sits on the same baseline, at the
    // same height, regardless of name length or column content.
    const headerBoxes = await boxes(page, L1_NAMES);
    expectAllClose(
      headerBoxes.map((b) => b.top),
      `L1 header baseline at ${String(width)}px`,
    );
    expectAllClose(
      headerBoxes.map((b) => b.height),
      `L1 header title row height at ${String(width)}px`,
    );

    // (2) Every populated L2 tile is the same height, whatever its own
    // content — the primary link's direct parent is the tile's own root
    // content box (CapabilityTile.tsx: `<div className={tile}><Link
    // className={primaryLink}>...`), so this measures the tile itself,
    // not just its name text.
    const l2Names = ['Service Desk', 'Metering', 'Billing', 'Complaints', 'Payroll'];
    const l2Boxes: number[] = [];
    for (const name of l2Names) {
      const box = await page.getByRole('link', { name, exact: true }).locator('xpath=..').boundingBox();
      if (!box) throw new Error(`no bounding box for L2 tile "${name}"`);
      l2Boxes.push(box.height);
    }
    expectAllClose(l2Boxes, `L2 tile height at ${String(width)}px`);

    // (3) Column order follows the seeded `order` attribute (Estates,
    // Digital & Technology, the long name, Customer Contact, Finance,
    // left to right) — `layout.ts`'s `compareCapabilities`, not seed/DB
    // insertion order. All five fit one row at this width, so "left to
    // right" is exactly increasing `x`.
    const xPositions: number[] = [];
    for (const name of L1_NAMES) {
      const box = await page.getByRole('link', { name, exact: true }).boundingBox();
      if (!box) throw new Error(`no bounding box for L1 header "${name}"`);
      xPositions.push(box.x);
    }
    for (let i = 1; i < xPositions.length; i++) {
      const current = L1_NAMES[i] ?? '?';
      const previous = L1_NAMES[i - 1] ?? '?';
      expect(xPositions[i], `column ${String(i)} ("${current}") should sit right of column ${String(i - 1)} ("${previous}") at ${String(width)}px`).toBeGreaterThan(xPositions[i - 1] ?? 0);
    }

    // Every column the same width — `grid-template-columns: repeat(N,
    // minmax(0, 1fr))` (CapabilityMapView.module.css) gives every track
    // an equal share by construction, so the gap between consecutive
    // columns' own left edges should be identical too (not just "each
    // one wider than the last").
    const gaps = xPositions.slice(1).map((x, i) => x - (xPositions[i] ?? 0));
    expectAllClose(gaps, `column-to-column spacing at ${String(width)}px`, 2);
  }
});
