/**
 * V2 "landscape focus and filters": the four Playwright scenarios named in
 * the plan — focus mode (click-to-focus/click-again-to-navigate/re-focus/
 * clear), filtering to one capability, and the three lane collapse/pin
 * scenarios from decision 1 (UI-principles.md §10), each proven to persist
 * across a reload.
 *
 * V2b: the focus panel and the top filter strip are both gone now — folded
 * into the shared Inspector (`src/ui/components/Inspector`), open by
 * default with nothing focused yet (a fresh session has no saved
 * `inspector_collapsed` preference), so `e2e/integration-platforms.spec.ts`'s
 * own "Route via platforms" checkbox locator (now inside the Inspector's
 * Connections section, itself open by default) and this spec's own
 * `Capability` facet locator still resolve without any extra click to open
 * anything first.
 *
 * Same "Canvas 2D, not DOM" technique every other landscape e2e spec here
 * uses: `computeLandscapeLayout` (the real, deterministic layout function
 * the app itself calls) run directly in the test against the seeded rows,
 * converted to screen coordinates via the canvas's own live `data-scale`/
 * `data-tx`/`data-ty` transform (`e2e/landscape-navigation.spec.ts`'s own
 * module comment has the full reasoning).
 *
 * Same "needs a real Supabase" limitation as every Playwright test here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../src/contracts/rows';
import { commitToBranch } from '../src/db/commits';
import { loadEnv } from '../src/db/env';
import { getOrCreateManualSource } from '../src/db/sources';
import { computeLandscapeLayout, NODE_HEIGHT, NODE_WIDTH } from '../src/ui/landscape/layout';
import { bootstrapChangeBranchFixture } from './fixtures/changeBranchFixture';

test('landscape focus: click focuses (neighbours full opacity via data attributes, rest implied faded), the same tile again navigates, a different tile re-focuses, and background/Escape both clear', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system is "Core Billing".
  const fixture = await bootstrapChangeBranchFixture(page, env, 'focus', 'Core Billing');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: coreBillingId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capBillingId = randomUUID();
  const capPeopleId = randomUUID();
  const paymentGatewayId = randomUUID();
  const hrSystemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capBillingId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: capPeopleId, elementType: 'capability', name: 'People', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: coreBillingId, toElementId: capBillingId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: paymentGatewayId, elementType: 'system', name: 'Payment Gateway', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    // Sprint U4-1 B5: a `uses`/`flows_to` edge needs a mandatory verb-phrase description — Core Billing's own one and only neighbour.
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: paymentGatewayId, toElementId: coreBillingId, attributes: { description: 'reads billing records from' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: hrSystemId, elementType: 'system', name: 'HR System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: hrSystemId, toElementId: capPeopleId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed Billing/People and their systems', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-focus fixture: ${seedResult.message}`);

  const coreBillingRow: ElementsHeadRow = { element_id: coreBillingId, element_type: 'system', name: 'Core Billing', parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const paymentGatewayRow: ElementsHeadRow = { element_id: paymentGatewayId, element_type: 'system', name: 'Payment Gateway', parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const hrSystemRow: ElementsHeadRow = { element_id: hrSystemId, element_type: 'system', name: 'HR System', parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: false }, exists_delta_id: randomUUID() };
  const capBillingRow: ElementsHeadRow = { element_id: capBillingId, element_type: 'capability', name: 'Billing', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const capPeopleRow: ElementsHeadRow = { element_id: capPeopleId, element_type: 'capability', name: 'People', parent_id: null, attributes: {}, exists_delta_id: randomUUID() };
  const supportsEdges: RelationshipsHeadRow[] = [
    { relationship_id: 'r1', relationship_type: 'supports', from_element_id: coreBillingId, to_element_id: capBillingId, attributes: { role: 'primary' }, exists_delta_id: 'd1' },
    { relationship_id: 'r2', relationship_type: 'supports', from_element_id: hrSystemId, to_element_id: capPeopleId, attributes: { role: 'primary' }, exists_delta_id: 'd2' },
  ];
  const layout = computeLandscapeLayout([coreBillingRow, paymentGatewayRow, hrSystemRow], supportsEdges, new Map([[capBillingId, capBillingRow], [capPeopleId, capPeopleRow]]));
  const coreBillingNode = layout.nodes.find((n) => n.elementId === coreBillingId);
  const paymentGatewayNode = layout.nodes.find((n) => n.elementId === paymentGatewayId);
  const hrSystemNode = layout.nodes.find((n) => n.elementId === hrSystemId);
  if (!coreBillingNode || !paymentGatewayNode || !hrSystemNode) throw new Error('computeLandscapeLayout did not place every seeded system');

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  // 3 lanes, not 2: Payment Gateway has no `supports` edge of its own (only
  // the `uses` edge into Core Billing), so it lands in Unassigned alongside
  // Billing and People.
  await expect(canvas).toHaveAttribute('aria-label', /3 systems across 3 lanes/, { timeout: 30_000 });

  const wrapper = page.locator('[data-scale]');
  const scale = Number(await wrapper.getAttribute('data-scale'));
  const tx = Number(await wrapper.getAttribute('data-tx'));
  const ty = Number(await wrapper.getAttribute('data-ty'));
  const screenOf = (node: { x: number; y: number }) => ({ x: (node.x + NODE_WIDTH / 2) * scale + tx, y: (node.y + NODE_HEIGHT / 2) * scale + ty });
  const coreBillingScreen = screenOf(coreBillingNode);
  const hrSystemScreen = screenOf(hrSystemNode);

  // 1. Click Core Billing: it's now the focused element, and Payment
  // Gateway (its only `uses` neighbour) is the one system in the
  // neighbour set — HR System, unrelated, is neither.
  await canvas.click({ position: coreBillingScreen });
  await expect(wrapper).toHaveAttribute('data-focused-element-id', coreBillingId);
  await expect(wrapper).toHaveAttribute('data-focus-neighbour-ids', paymentGatewayId);
  // V2b: the Inspector's own Selection/Connections sections replace the old
  // focus panel's "Focused: {name} · {N} neighbours" summary line.
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('Core Billing', { exact: true })).toBeVisible();
  await expect(inspector.getByRole('link', { name: 'Payment Gateway' })).toBeVisible();

  // 2. Clicking the *same*, already-focused tile again navigates — today's
  // exact pre-V2 behaviour, unchanged in that one case (decision 2).
  await canvas.click({ position: coreBillingScreen });
  await expect(page).toHaveURL(new RegExp(`/context/${coreBillingId}\\?ref=main`));

  // 3. Fresh load (focus state resets): click Core Billing, then a
  // *different* tile (HR System, no shared edge) — re-focuses onto it
  // rather than navigating, and the neighbour set is now empty.
  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  await expect(canvas).toHaveAttribute('aria-label', /3 systems across 3 lanes/, { timeout: 30_000 });
  await canvas.click({ position: coreBillingScreen });
  await expect(wrapper).toHaveAttribute('data-focused-element-id', coreBillingId);
  await canvas.click({ position: hrSystemScreen });
  await expect(page).toHaveURL(new RegExp(`/o/${orgSlug}/m/${modelSlug}/landscape`)); // still here — this was a re-focus, not a navigation
  await expect(wrapper).toHaveAttribute('data-focused-element-id', hrSystemId);
  await expect(wrapper).toHaveAttribute('data-focus-neighbour-ids', '');

  // 4. A background click (empty canvas — the world-space margin above and
  // left of every tile, PADDING=32 in `layout.ts`, so world (2, 2) is
  // guaranteed clear) clears focus, same as Escape.
  await canvas.click({ position: { x: 2 * scale + tx, y: 2 * scale + ty } });
  await expect(wrapper).toHaveAttribute('data-focused-element-id', '');

  await canvas.click({ position: hrSystemScreen });
  await expect(wrapper).toHaveAttribute('data-focused-element-id', hrSystemId);
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(wrapper).toHaveAttribute('data-focused-element-id', '');
});

test('landscape filters: checking one capability narrows the canvas to its own systems and records the choice in the URL', async ({ page }) => {
  const env = loadEnv();
  // The fixture's own seeded system supports Alpha alongside a second
  // system; a third, unrelated system supports Beta.
  const fixture = await bootstrapChangeBranchFixture(page, env, 'filters', 'Alpha System One');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: alphaOneId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capAlphaId = randomUUID();
  const capBetaId = randomUUID();
  const alphaTwoId = randomUUID();
  const betaOneId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capAlphaId, elementType: 'capability', name: 'Alpha Capability', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: capBetaId, elementType: 'capability', name: 'Beta Capability', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: alphaOneId, toElementId: capAlphaId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: alphaTwoId, elementType: 'system', name: 'Alpha System Two', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: alphaTwoId, toElementId: capAlphaId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: betaOneId, elementType: 'system', name: 'Beta System One', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: betaOneId, toElementId: capBetaId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed Alpha/Beta capabilities and three systems', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-filters fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /3 systems across 2 lanes/, { timeout: 30_000 });

  await page.locator('summary', { hasText: 'Capability' }).click();
  // The checkbox reflects the URL, which updates a beat after the click — `.check()` reads it too early.
  await page.getByRole('checkbox', { name: 'Alpha Capability' }).click();
  await expect(page.getByRole('checkbox', { name: 'Alpha Capability' })).toBeChecked();

  await expect(page).toHaveURL(new RegExp(`capabilities=${capAlphaId}`));
  // "Canvas shows only matches" — the two Alpha-supporting systems remain, across the one lane; Beta System One (and its own lane) are gone entirely.
  await expect(canvas).toHaveAttribute('aria-label', /2 systems across 1 lanes/, { timeout: 15_000 });
});

test('landscape filters: a facet stays open across two selections, no re-opening needed', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'facetstay', 'Facet System');
  const { orgSlug, modelSlug } = fixture;

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });

  await page.locator('summary', { hasText: 'Lifecycle' }).click();
  // `.click()` then an assertion, not `.check()`: these checkboxes follow
  // the URL's own filter state, which settles a tick after the click —
  // `.check()` reads the state back immediately and calls that a failure.
  await page.getByRole('checkbox', { name: 'Active' }).click();
  await expect(page.getByRole('checkbox', { name: 'Active' })).toBeChecked();
  // Regression: a filter change used to reset `useLandscapeDisplay`'s own
  // state to 'loading' while the worker recomputed the layout, which
  // unmounted the whole canvas+Inspector subtree gated on it
  // (`LandscapePage.tsx`) — closing every open `<details>` facet
  // (`LandscapeFilterBar.tsx`) along with it. Checking a second option in
  // the *same* facet with no intervening `summary` click proves it never
  // closed; a closed `<details>` would make this `.check()` time out
  // (the checkbox inside it is not visible to Playwright).
  await page.getByRole('checkbox', { name: 'Planned' }).click();
  await expect(page.getByRole('checkbox', { name: 'Active' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Planned' })).toBeChecked();
});

test('landscape lanes: collapse/expand and pin, each remembered per user across a reload', async ({ page }) => {
  const env = loadEnv();
  const fixture = await bootstrapChangeBranchFixture(page, env, 'lanepref', 'Alpha System');
  const { signedIn: owner, orgId, orgSlug, modelId, modelSlug, systemId: alphaSystemId, userId: ownerId, main } = fixture;

  const source = await getOrCreateManualSource(owner, { id: randomUUID(), orgId, modelId, userId: ownerId });
  const capAlphaId = randomUUID();
  const capBetaId = randomUUID();
  const capGammaId = randomUUID();
  const betaSystemId = randomUUID();
  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: capAlphaId, elementType: 'capability', name: 'Alpha Capability', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: capBetaId, elementType: 'capability', name: 'Beta Capability', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    // Gamma is never anyone's *primary* lane — it exists purely as a
    // reference target (Alpha System's own secondary supports edge), the
    // only way a lane can appear with zero placed members at all
    // (`groupSystemsByLane`'s own `byLane.set(otherLaneKey, [])`).
    { kind: 'element.create', id: randomUUID(), elementId: capGammaId, elementType: 'capability', name: 'Gamma Capability', parentId: null, attributes: {}, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: alphaSystemId, toElementId: capAlphaId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: alphaSystemId, toElementId: capGammaId, attributes: { role: 'secondary' }, sourceId: source.id, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: betaSystemId, elementType: 'system', name: 'Beta System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: betaSystemId, toElementId: capBetaId, attributes: { role: 'primary' }, sourceId: source.id, confidence: 1 },
  ];
  const envelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed Alpha/Beta/Gamma, Gamma referenced but never primary', body: null, deltas };
  const seedResult = await commitToBranch(owner, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding landscape-lanepref fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /2 systems across 3 lanes/, { timeout: 30_000 });

  // 1. Collapse a non-empty lane (Alpha, one member — expanded by default)
  // and reload: it stays collapsed.
  await expect(page.getByRole('button', { name: 'Collapse Alpha Capability lane' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Alpha Capability lane' }).click();
  await expect(page.getByRole('button', { name: 'Expand Alpha Capability lane' })).toBeVisible();
  await page.reload();
  // A collapsed lane places zero member tiles (`layout.ts`'s own
  // `placeLane`) — Alpha System itself is no longer drawn, so the count
  // drops from 2 to 1; still 3 lanes, since collapsing never removes a
  // lane, only hides its members.
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 3 lanes/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Expand Alpha Capability lane' })).toBeVisible();

  // 2. Expand an empty lane (Gamma — collapsed by default, no members at
  // all) and reload: it stays expanded. Gamma has no members regardless of
  // its own collapse state, so the system count is unaffected by this step
  // — still 1 (Alpha stays collapsed from step 1).
  await expect(page.getByRole('button', { name: 'Expand Gamma Capability lane' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Gamma Capability lane' }).click();
  await expect(page.getByRole('button', { name: 'Collapse Gamma Capability lane' })).toBeVisible();
  await page.reload();
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 3 lanes/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Collapse Gamma Capability lane' })).toBeVisible();

  // 3. Pin Beta, then Alpha — pinned order is user-set (append order), so
  // Beta leads, Alpha second, Gamma (never pinned) trails, regardless of
  // the plain alphabetical order the three would otherwise sort in. Pin
  // state doesn't affect collapse — still 1 system, Alpha still collapsed.
  // Each pin is saved to the user's preferences in the background; wait for
  // each save to land before reloading, or the reload can outrun them.
  const savedPreference = () => page.waitForResponse((r) => r.url().includes('/user_preferences') && r.request().method() !== 'GET' && r.ok());
  await Promise.all([savedPreference(), page.getByRole('button', { name: 'Pin Beta Capability lane' }).click()]);
  await Promise.all([savedPreference(), page.getByRole('button', { name: 'Pin Alpha Capability lane' }).click()]);
  await page.reload();
  await expect(canvas).toHaveAttribute('aria-label', /1 systems across 3 lanes/, { timeout: 30_000 });
  const laneTexts = await page.getByRole('listitem').allTextContents();
  const betaIndex = laneTexts.findIndex((t) => t.includes('Beta Capability'));
  const alphaIndex = laneTexts.findIndex((t) => t.includes('Alpha Capability'));
  const gammaIndex = laneTexts.findIndex((t) => t.includes('Gamma Capability'));
  expect(betaIndex).toBeGreaterThanOrEqual(0);
  expect(betaIndex).toBeLessThan(alphaIndex);
  expect(alphaIndex).toBeLessThan(gammaIndex);
});
