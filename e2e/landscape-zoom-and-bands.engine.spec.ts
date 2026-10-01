/**
 * Landscape canvas, structural — item 1 (zoom/pan) and item 4's own
 * acceptance criteria not already covered by e2e/landscape-lanes.spec.ts
 * (a system with two supports appearing once with a reference chip in the
 * other lane — that scenario already exists there and still passes
 * unmodified against this pass's own reference-marker/fit-transform
 * changes).
 *
 * Same "Canvas 2D, not DOM" approach as the other landscape e2e specs:
 * `data-scale`/`data-tx`/`data-ty` on the canvas's own wrapper (added this
 * pass specifically so a test can read the live transform) stand in for
 * reaching into component state or drawn pixels.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import type { ElementsHeadRow } from '../src/contracts/rows';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';

async function signUpAndCreateModel(page: Page, prefix: string) {
  const env = loadEnv();
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`${prefix} fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`${prefix} fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `${prefix}-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: `${prefix} Test Org`, slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `${prefix}-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: `${prefix} Test Model`, slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  return { signedIn, orgId, orgSlug, modelId, modelSlug, main, genesisCommitId, seedSourceId };
}

test('landscape zoom: wheel out ten times never drops the scale below the 0.25 floor, and Fit restores full visibility', async ({ page }) => {
  const { signedIn, modelId, orgSlug, modelSlug, main, genesisCommitId, seedSourceId } = await signUpAndCreateModel(page, 'landscape-zoom');

  const systemId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-zoom fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });
  const wrapper = page.locator('[data-scale]');

  const box = await canvas.boundingBox();
  if (!box) throw new Error('landscape canvas has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Ten wheel-out steps (positive deltaY — LandscapeCanvas.tsx's own
  // handleWheel: "deltaY < 0 zooms in, else out"). Item 1: "clamped
  // 0.25×–4×" — ten steps at the same 1/1.1 factor the '−' button and key
  // use would drop well under 0.25 with no floor at all.
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 120);
  }
  const scaleAfterWheeling = Number(await wrapper.getAttribute('data-scale'));
  expect(scaleAfterWheeling).toBeGreaterThanOrEqual(0.25);
  expect(scaleAfterWheeling).toBeLessThan(1); // proof the wheeling actually did something, not just that the floor held

  // Fit (the on-canvas corner control, item 1) restores full visibility —
  // every node lands back inside the wrapper's own bounds.
  await page.getByRole('button', { name: 'Fit to view' }).click();
  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  const wrapperWidth = await wrapper.evaluate((el) => el.clientWidth);
  const wrapperHeight = await wrapper.evaluate((el) => el.clientHeight);
  expect(scale).toBeGreaterThanOrEqual(0.25);
  expect(scale).toBeLessThanOrEqual(4);
  // The diagram's own top-left corner (world origin) and the layout's full
  // extent both land inside the wrapper after fitting — "fully visible"
  // made concrete without reaching into layout internals this test doesn't
  // need (a one-system model's layout is comfortably smaller than 1280×any
  // reasonable wrapper height either way).
  expect(tx).toBeGreaterThanOrEqual(0);
  expect(ty).toBeGreaterThanOrEqual(0);
  expect(1280 * scale + tx).toBeLessThanOrEqual(wrapperWidth + 1); // LAYOUT_WIDTH — every lane's own right edge
  expect(ty).toBeLessThanOrEqual(wrapperHeight);
});

test('landscape zoom: a burst of small-delta wheel events (trackpad/high-resolution-mouse simulation) after a button zoom never blanks the canvas', async ({ page }) => {
  // Regression for the reported bug: Fit, then the on-canvas "+" button
  // (fine on its own), then the wheel — the canvas ended up completely
  // blank. Root cause (`zoom.ts`'s own `wheelZoomFactor` comment):
  // `handleWheel` used to apply a flat 1.1x step per native `wheel` event
  // regardless of that event's own `deltaY`, so a burst of many
  // small-delta events (what a trackpad or a high-resolution mouse sends
  // for a single physical gesture — simulated here as many small
  // `mouse.wheel` calls rather than one call with a large delta) compounded
  // to MAX_SCALE almost instantly and, since zoom is about the cursor,
  // could pan the diagram clean off screen if the cursor wasn't sitting
  // exactly over the content.
  const { signedIn, modelId, orgSlug, modelSlug, main, genesisCommitId, seedSourceId } = await signUpAndCreateModel(page, 'landscape-wheel-burst');

  const systemId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed one system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-wheel-burst fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });
  const wrapper = page.locator('[data-scale]');

  const box = await canvas.boundingBox();
  if (!box) throw new Error('landscape canvas has no bounding box');

  // The on-canvas "+" button (item 1's own control), same as the reported
  // repro's step 2 — this moves the cursor away from the diagram's own
  // centre to the toolbar's corner, exactly where the reported repro's
  // wheel events then landed.
  await page.getByRole('button', { name: 'Zoom in' }).click();

  // A burst of many small-delta wheel events near that same corner —
  // standing in for a trackpad/high-resolution mouse's many small `wheel`
  // events per physical gesture (the fixed-factor code used to treat each
  // one as a full notch).
  const cornerX = box.x + box.width - 20;
  const cornerY = box.y + 20;
  await page.mouse.move(cornerX, cornerY);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 5);
  }

  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  expect(scale).toBeGreaterThanOrEqual(0.25);
  expect(scale).toBeLessThanOrEqual(4);

  // The one seeded system's own layout position (same deterministic pure
  // layout function the app itself calls) must still land inside the
  // wrapper's own visible bounds once mapped through the live transform —
  // "not blank" made concrete, the same way the existing Fit test above
  // proves "fully visible" without reaching into drawn pixels.
  const systemRow: ElementsHeadRow = { element_id: systemId, element_type: 'system', name: 'Billing Service', parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const layout = computeLandscapeLayout([systemRow], [], new Map(), []);
  const node = layout.nodes.find((n) => n.elementId === systemId);
  if (!node) throw new Error('computeLandscapeLayout did not place the seeded system');
  const wrapperWidth = await wrapper.evaluate((el) => el.clientWidth);
  const wrapperHeight = await wrapper.evaluate((el) => el.clientHeight);
  const nodeScreenCentreX = (node.x + NODE_WIDTH / 2) * scale + tx;
  const nodeScreenCentreY = (node.y + NODE_HEIGHT / 2) * scale + ty;
  expect(nodeScreenCentreX).toBeGreaterThanOrEqual(0);
  expect(nodeScreenCentreX).toBeLessThanOrEqual(wrapperWidth);
  expect(nodeScreenCentreY).toBeGreaterThanOrEqual(0);
  expect(nodeScreenCentreY).toBeLessThanOrEqual(wrapperHeight);
});

test('landscape bands: four systems across four level-1 lanes fill the canvas width at 1280px with no page-level horizontal scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { signedIn, modelId, orgSlug, modelSlug, main, genesisCommitId, seedSourceId } = await signUpAndCreateModel(page, 'landscape-bands');

  const capabilityIds = Array.from({ length: 4 }, () => randomUUID());
  const capabilityNames = ['Alpha Capability', 'Bravo Capability', 'Charlie Capability', 'Delta Capability'];
  const systemIds = Array.from({ length: 4 }, () => randomUUID());

  const deltas: CommitEnvelope['deltas'] = [];
  capabilityIds.forEach((id, i) => {
    deltas.push({ kind: 'element.create', id: randomUUID(), elementId: id, elementType: 'capability', name: capabilityNames[i] ?? `Capability ${String(i)}`, parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 });
  });
  systemIds.forEach((id, i) => {
    deltas.push({ kind: 'element.create', id: randomUUID(), elementId: id, elementType: 'system', name: `System ${String(i)}`, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 });
    const capabilityId = capabilityIds[i];
    if (capabilityId) deltas.push({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: id, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 });
  });

  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: genesisCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed four systems across four lanes', body: null, deltas };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-bands fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /4 systems across 4 lanes/, { timeout: 30_000 });

  // Item 2: "each level-1 lane spans the canvas width" — the fitted scale
  // is whatever fits LAYOUT_WIDTH into this page's own content column
  // (narrower than the full 1280px viewport once the persistent nav and
  // page padding are accounted for), never past 1× (fit never zooms in
  // past "see the whole thing"); it's real work either way, not the
  // identity transform doing nothing.
  const scale = Number(await page.locator('[data-scale]').getAttribute('data-scale'));
  expect(scale).toBeGreaterThan(0.25);
  expect(scale).toBeLessThanOrEqual(1);

  // The literal acceptance: no horizontal page scrollbar at 1280px — the
  // canvas fitting the whole (fixed-width) diagram into whatever column it
  // actually has is exactly what keeps the page itself from needing to
  // scroll sideways, regardless of the diagram's own 1280px design width.
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

test('landscape actors and boundary: the internal actor renders above the top band and the external one in the external lane below the boundary, and an actor tile navigates straight to its own element page', async ({ page }) => {
  const { signedIn, modelId, orgSlug, modelSlug, main, genesisCommitId, seedSourceId } = await signUpAndCreateModel(page, 'landscape-actors');

  const capabilityId = randomUUID();
  const systemId = randomUUID();
  const internalActorId = randomUUID();
  const externalActorId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a capability, a system, and two actors',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Revenues & Benefits', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Billing Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: internalActorId, elementType: 'actor', name: 'Housing Digital Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: externalActorId, elementType: 'actor', name: 'Vendor Contact', parentId: null, attributes: { subtype: 'person', isExternal: true }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-actors fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  // Item 3: both actors, external and internal together, in the aria-
  // label's own accessible summary of what the canvas drew.
  // Two lanes: the capability's, and the external lane an external actor
  // now gets below the boundary (`layout.ts`'s EXTERNAL_LANE_KEY).
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 2 lanes, 2 actors/, { timeout: 30_000 });

  // The exact same pure layout function the app calls, given this
  // fixture's own data — deterministic, so this is the real, expected
  // layout, not a guess at one.
  const capabilityRow: ElementsHeadRow = { element_id: capabilityId, element_type: 'capability', name: 'Revenues & Benefits', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const systemRow: ElementsHeadRow = { element_id: systemId, element_type: 'system', name: 'Billing Service', parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const internalActorRow: ElementsHeadRow = { element_id: internalActorId, element_type: 'actor', name: 'Housing Digital Team', parent_id: null, attributes: { subtype: 'team', isExternal: false }, exists_delta_id: randomUUID() };
  const externalActorRow: ElementsHeadRow = { element_id: externalActorId, element_type: 'actor', name: 'Vendor Contact', parent_id: null, attributes: { subtype: 'person', isExternal: true }, exists_delta_id: randomUUID() };
  const supportsEdges = [{ relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capabilityId, attributes: { role: 'primary' }, exists_delta_id: 'd1' }];
  const layout = computeLandscapeLayout([systemRow], supportsEdges, new Map([[capabilityId, capabilityRow]]), [internalActorRow, externalActorRow]);

  // The internal actor sits above the boundary (item 3: "actors above the
  // top band"); the external one sits in the external lane below it
  // (S1 item 11a, `layout.ts`'s EXTERNAL_LANE_KEY placement).
  expect(layout.actorNodes).toHaveLength(2);
  const internalActorNode = layout.actorNodes.find((n) => n.elementId === internalActorId);
  if (!internalActorNode) throw new Error('computeLandscapeLayout did not place the internal actor');
  expect(internalActorNode.y).toBeLessThan(layout.boundary.top);
  const externalActorPlaced = layout.actorNodes.find((n) => n.elementId === externalActorId);
  if (!externalActorPlaced) throw new Error('computeLandscapeLayout did not place the external actor');
  expect(externalActorPlaced.y).toBeGreaterThan(layout.boundary.bottom);

  // An actor tile navigates straight to its own element page (no Context
  // view of its own, unlike a system).
  const externalActorNode = layout.actorNodes.find((n) => n.elementId === externalActorId);
  if (!externalActorNode) throw new Error('computeLandscapeLayout did not place the external actor');
  const wrapper = page.locator('[data-scale]');
  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  const actorPosition = { x: (externalActorNode.x + NODE_WIDTH / 2) * scale + tx, y: (externalActorNode.y + NODE_HEIGHT / 2) * scale + ty };
  // V2 "landscape focus and filters", decision 2: applies to an actor tile
  // exactly like a system one — the first click focuses, the second (same
  // tile, now already focused) navigates.
  await canvas.click({ position: actorPosition });
  await canvas.click({ position: actorPosition });
  await expect(page).toHaveURL(new RegExp(`/e/${externalActorId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Vendor Contact' })).toBeVisible();
});
