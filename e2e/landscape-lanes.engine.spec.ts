/**
 * Sprint U4-1 B4: landscape lanes are level-1 capabilities only, and a
 * system's tile appears exactly once — in its *primary* supports edge's
 * level-1 lane — never a duplicate tile in every level-1 lane it happens
 * to touch. The sprint's own scenario: a system supports a level-2
 * capability under "Network Operations" (level 1) and, separately,
 * "Asset Management" directly (level 1) — with Asset Management marked
 * primary, the system's one tile lands there, and Network Operations
 * gets a reference marker instead of a second tile.
 *
 * Same "Canvas 2D, not DOM" limitation as e2e/landscape-navigation.spec.ts
 * (LandscapeCanvas.tsx's own module comment): this computes the expected
 * layout with the exact same pure, deterministic `computeLandscapeLayout`
 * the app itself calls, then checks the real page's canvas against it —
 * a node position to click, and the aria-label's system/lane counts —
 * rather than trying to read drawn pixels.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import type { ElementsHeadRow } from '../src/contracts/rows';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';

test('a system supporting a level-2 capability and a level-1 capability appears once, in its primary lane, with a reference in the other', async ({ page }) => {
  const env = loadEnv();

  const email = `landscapelanes-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-lanes fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-lanes fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscapelanes-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Lanes Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscapelanes-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Lanes Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const networkOperationsId = randomUUID();
  const outageAndFaultId = randomUUID(); // level 2, under Network Operations
  const assetManagementId = randomUUID();
  const systemId = randomUUID();
  const systemName = 'PowerON';

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed capabilities and a multi-lane system',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: networkOperationsId, elementType: 'capability', name: 'Network Operations', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: outageAndFaultId, elementType: 'capability', name: 'Outage & Fault Management', parentId: networkOperationsId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: assetManagementId, elementType: 'capability', name: 'Asset Management', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      // Added first, secondary — the system's own initial supports link.
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: outageAndFaultId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      // Added second, explicitly primary — B4's picker flow answering "yes" to this system's second supports link.
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: assetManagementId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-lanes fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  // One system, two level-1 lanes (Asset Management for the tile,
  // Network Operations for the reference) — never a third lane for the
  // level-2 capability itself, and never a second system tile.
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 2 lanes/, { timeout: 30_000 });

  // The exact same pure layout function LandscapeCanvas.tsx calls, given
  // this fixture's own data — deterministic, so this is the real,
  // expected layout, not a guess at one.
  const systemRow: ElementsHeadRow = { element_id: systemId, element_type: 'system', name: systemName, parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const networkOperationsRow: ElementsHeadRow = { element_id: networkOperationsId, element_type: 'capability', name: 'Network Operations', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const assetManagementRow: ElementsHeadRow = { element_id: assetManagementId, element_type: 'capability', name: 'Asset Management', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const supportsEdges = [
    { relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: outageAndFaultId, attributes: { role: 'secondary' }, exists_delta_id: 'd1' },
    { relationship_id: 'r2', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: assetManagementId, attributes: { role: 'primary' }, exists_delta_id: 'd2' },
  ];
  // The level-2 capability (Outage & Fault Management) rolls up to
  // Network Operations; Asset Management is already level 1.
  const l1AncestorByCapabilityId = new Map([
    [outageAndFaultId, networkOperationsRow],
    [assetManagementId, assetManagementRow],
  ]);
  const layout = computeLandscapeLayout([systemRow], supportsEdges, l1AncestorByCapabilityId);

  // Exactly one tile, in Asset Management's lane — never a duplicate.
  expect(layout.nodes).toHaveLength(1);
  const node = layout.nodes[0];
  if (!node) throw new Error('computeLandscapeLayout did not place the seeded system');
  const assetManagementLane = layout.lanes.find((l) => l.key === assetManagementId);
  if (!assetManagementLane) throw new Error('expected an Asset Management lane');
  expect(node.y).toBe(assetManagementLane.y + 28); // LANE_LABEL_HEIGHT — placed in the primary's own lane
  expect(node.extraLaneCount).toBeUndefined(); // an explicit primary was set — this isn't the "no primary" fallback

  // A reference in the other lane (Network Operations) — not a second tile,
  // positioned as a real chip at that lane's own right edge (Landscape
  // canvas, structural, item 2), never text folded into its label.
  expect(layout.referenceMarkers).toEqual([{ elementId: systemId, laneKey: networkOperationsId, x: expect.any(Number), y: expect.any(Number) }]);

  // The one real tile is clickable, at exactly the position computed above
  // — converted from world to screen coordinates via the canvas's own live
  // fit-to-view transform (item 1), never assumed to be identity.
  const wrapper = page.locator('[data-scale]');
  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  await canvas.click({ position: { x: (node.x + NODE_WIDTH / 2) * scale + tx, y: (node.y + NODE_HEIGHT / 2) * scale + ty } });
  await expect(page).toHaveURL(new RegExp(`/context/${systemId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
});
