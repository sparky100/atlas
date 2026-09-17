/**
 * V2b's Inspector, Context rollout: click-to-focus on the diagram's own
 * desktop canvas — the same two-step model Landscape's own canvas already
 * uses (a first click opens the Inspector without navigating; a second
 * click on the already-focused tile navigates), decided over Capability
 * map's corner-button approach because Context's diagram is the same
 * Canvas 2D renderer Landscape's own already is (UI-principles.md §6.5).
 *
 * Same "Canvas 2D, not DOM" technique every other landscape/context e2e
 * spec here uses: `computeContextDiagramLayout` (the real, deterministic
 * layout function the app itself calls, with no `layoutWidthHint` passed —
 * `ContextView.tsx` doesn't pass one, so both this test and the real
 * component fall back to the same `MIN_DIAGRAM_WIDTH` default) run
 * directly against the seeded rows, converted to screen coordinates via
 * the canvas's own live `data-scale`/`data-tx`/`data-ty` transform
 * (`e2e/landscape-navigation.spec.ts`'s own module comment has the full
 * reasoning).
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';
import { computeContextDiagramLayout } from '../src/ui/context/contextDiagramLayout';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('context inspector: clicking a neighbour tile focuses it (Selection/Connections), a second click navigates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const env = loadEnv();
  // The fixture's own seeded system is the hub, "Core Billing".
  const fixture = await bootstrapChangeBranchFixture(page, env, 'ctxinspector', 'Core Billing');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: hubId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const neighbourId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: neighbourId, elementType: 'system', name: 'Payment Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    // Sprint U4-1 B5: a `uses`/`flows_to` edge needs a mandatory verb-phrase description.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: neighbourId, toElementId: hubId, attributes: { description: 'reads billing records from' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed one neighbour with a uses edge into the hub', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding the context-inspector fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${hubId}`);
  const canvas = page.locator('canvas');
  await expect(page.getByRole('img', { name: /Context diagram: Core Billing and 1 connected/ })).toBeVisible({ timeout: 30_000 });

  const layout = computeContextDiagramLayout(hubId, [neighbourId], [], undefined, [{ id: 'edge', neighbourId, arrowAtHub: true, label: '← reads billing records from' }]);
  const neighbourTile = layout.internalNeighbours.find((t) => t.elementId === neighbourId);
  if (!neighbourTile) throw new Error('computeContextDiagramLayout did not place the seeded neighbour');
  const wrapper = page.locator('[data-scale]');
  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  const screenOf = (tile: { x: number; y: number }) => ({ x: (tile.x + NODE_WIDTH / 2) * scale + tx, y: (tile.y + NODE_HEIGHT / 2) * scale + ty });
  const neighbourScreen = screenOf(neighbourTile);

  // Nothing focused yet — the Inspector's own empty state.
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('Nothing focused.')).toBeVisible();

  // First click: focuses, no navigation.
  await canvas.click({ position: neighbourScreen });
  await expect(wrapper).toHaveAttribute('data-focused-element-id', neighbourId);
  await expect(page).toHaveURL(new RegExp(`/context/${hubId}$`));
  await expect(inspector.getByText('Payment Gateway', { exact: true })).toBeVisible();
  await expect(inspector.getByText(/reads billing records from/)).toBeVisible();

  // Second click on the already-focused tile: navigates (Payment Gateway
  // is a system, so this drills into its own Context page).
  await canvas.click({ position: neighbourScreen });
  await expect(page).toHaveURL(new RegExp(`/context/${neighbourId}`));
});
