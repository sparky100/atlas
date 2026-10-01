/**
 * Sprint U4-2b item 11: "Tap on a '+N' chip lists the other capabilities
 * with links." The chip only ever appears on a node whose lane placement
 * fell back to "most recently added" (Sprint U4-1 B4 — no explicit
 * `role: 'primary'` supports edge, so the fallback picks one and flags it
 * "+N" for the rest, `layout.ts`'s own `placementFor`) — this fixture
 * gives one system two supports edges, neither primary, so both
 * conditions (`extraLaneCount` present, a real "other" lane to list) hold.
 *
 * Same "Canvas 2D, not DOM" approach as e2e/landscape-lanes.spec.ts: the
 * exact same pure `computeLandscapeLayout` the app calls locates the "+N"
 * marker's own world position (top-right corner of the node, `Landscape
 * canvas, structural`'s own drawing comment in `LandscapeCanvas.tsx`), then
 * `data-scale`/`data-tx`/`data-ty` convert it to a screen point to click.
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
import { computeLandscapeLayout, NODE_WIDTH } from '../src/ui/landscape/layout';

test('tapping a "+N" chip lists the system\'s other capabilities, and each one links to that capability\'s element page', async ({ page }) => {
  const env = loadEnv();

  const email = `landscape-extralane-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-extralane fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-extralane fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscape-extralane-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Extra Lane Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscape-extralane-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Extra Lane Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const capAId = randomUUID();
  const capZId = randomUUID();
  const systemId = randomUUID();
  // "Most recently added" compares delta ids as strings, assuming UUID v7
  // (src/contracts/delta.ts). Plain random ids would make the winner
  // random, so give cap-z's edge the later-sorting id explicitly.
  const [alphaEdgeDeltaId, zetaEdgeDeltaId] = [randomUUID(), randomUUID()].sort() as [string, string];
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a multi-lane system with no explicit primary',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capAId, elementType: 'capability', name: 'Alpha Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capZId, elementType: 'capability', name: 'Zeta Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: 'Multi-Homed Service', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      // Neither edge is 'primary' — cap-z's is added second (most recently
      // added wins, layout.ts's own placementFor), so the tile lands in
      // Zeta's lane with a "+N" (here "+1") chip referencing Alpha.
      { kind: 'relationship.create', id: alphaEdgeDeltaId, relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capAId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: zetaEdgeDeltaId, relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: capZId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-extralane fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 2 lanes/, { timeout: 30_000 });

  // The same pure, deterministic layout function the app itself calls,
  // given this fixture's own data — real, expected node placement, not a
  // guess (same technique e2e/landscape-lanes.spec.ts already uses).
  const capARow: ElementsHeadRow = { element_id: capAId, element_type: 'capability', name: 'Alpha Capability', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const capZRow: ElementsHeadRow = { element_id: capZId, element_type: 'capability', name: 'Zeta Capability', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const systemRow: ElementsHeadRow = { element_id: systemId, element_type: 'system', name: 'Multi-Homed Service', parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const supportsEdges = [
    { relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capAId, attributes: {}, exists_delta_id: 'd0001' },
    { relationship_id: 'r2', relationship_type: 'supports' as const, from_element_id: systemId, to_element_id: capZId, attributes: {}, exists_delta_id: 'd0002' },
  ];
  const l1AncestorByCapabilityId = new Map([[capAId, capARow], [capZId, capZRow]]);
  const layout = computeLandscapeLayout([systemRow], supportsEdges, l1AncestorByCapabilityId);
  const node = layout.nodes.find((n) => n.elementId === systemId);
  if (!node) throw new Error('computeLandscapeLayout did not place the system');
  expect(node.extraLaneCount).toBe(1);

  const wrapper = page.locator('[data-scale]');
  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  // The "+N" marker's own drawn centre (LandscapeCanvas.tsx's own
  // `extraLaneMarkers.push` — top-right corner, 4px inset each way).
  const markerScreenX = (node.x + NODE_WIDTH - 4) * scale + tx;
  const markerScreenY = (node.y + 4) * scale + ty;

  await canvas.click({ position: { x: markerScreenX, y: markerScreenY } });
  const popover = page.getByRole('menu');
  await expect(popover).toBeVisible();
  const alphaLink = popover.getByRole('menuitem', { name: 'Alpha Capability' });
  await expect(alphaLink).toBeVisible();

  await alphaLink.click();
  await expect(page).toHaveURL(new RegExp(`/e/${capAId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Alpha Capability' })).toBeVisible();
});
