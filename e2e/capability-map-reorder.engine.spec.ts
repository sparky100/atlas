/**
 * Sprint U4-1 C1: "tailoring allows drag-to-reorder among siblings
 * (attribute update)". Implemented as move-up/down buttons at every level
 * rather than a mouse drag gesture — useCapabilityReorder.ts's own module
 * comment explains why (no drag-and-drop anywhere else in this codebase,
 * no DnD library, and buttons stay keyboard-/screen-reader-operable) —
 * the *effect* (a capability swaps places with an adjacent sibling,
 * `attributes.order` updated) is the same either way; SPEC-data-model.md
 * §11 records a real drag gesture as a reviewed, deliberate follow-up,
 * not a gap in this item. Capability map redesign: domains stack
 * vertically now (no more side-by-side L1 columns), so L1's own move
 * buttons read "up"/"down" too, the same as L2/L3 always have — not
 * "left"/"right" any more (`CapabilityMapView.tsx`'s own `ReorderButtons`,
 * unified across every level). A domain's own move buttons live in its
 * expanded body, same place its own Inspect button and "Open →" link do.
 *
 * Also covers the review follow-up that tightened C1: every capability
 * gets an `order` at creation now (useCapabilityCreate.ts), including a
 * hand-added one — so a brand-new capability can be moved immediately,
 * with no "not orderable yet" disabled state left anywhere.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

/** `names`, sorted by each one's own domain row's real top-to-bottom position on the page — the vertical-stack equivalent of the old "query every link matching either name, in DOM order" trick, now that a domain's own name is plain text inside a collapsed row's button, not a link. */
async function domainOrder(page: Page, names: readonly string[]): Promise<string[]> {
  const withTops = await Promise.all(
    names.map(async (name) => {
      const box = await page.getByRole('listitem').filter({ hasText: name }).boundingBox();
      if (!box) throw new Error(`no bounding box for domain "${name}"`);
      return { name, top: box.y };
    }),
  );
  return withTops.sort((a, b) => a.top - b.top).map((w) => w.name);
}

test('reordering: move-right swaps two L1 capabilities, move-down swaps two L2 capabilities, and a hand-added capability can be moved immediately', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-reorder-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-reorder fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-reorder fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-reorder-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Reorder Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-reorder-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Reorder Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootAId = randomUUID();
  const rootBId = randomUUID();
  const childXId = randomUUID();
  const childYId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed two ordered L1 capabilities, each with an ordered L2 child',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: rootAId, elementType: 'capability', name: 'Root Alpha', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: rootBId, elementType: 'capability', name: 'Root Beta', parentId: null, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childXId, elementType: 'capability', name: 'Child X', parentId: rootAId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: childYId, elementType: 'capability', name: 'Child Y', parentId: rootAId, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-reorder fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByText('Root Alpha')).toBeVisible();

  // Sprint U4-2a item 3: the move buttons hide behind "Reorder mode" now
  // (off by default — see CapabilityMapView.tsx's own comment on why),
  // so they don't exist in the DOM at all until this is turned on.
  await page.getByLabel('Reorder mode').check();

  // A domain's own move buttons live in its expanded body — expand Root
  // Alpha to reach them (this also reveals its own L2 children, "Child
  // X"/"Child Y", needed below).
  await page.getByRole('button', { name: /Root Alpha/ }).click();

  // --- L1: move Root Alpha down, swapping places with Root Beta ---
  await page.getByRole('button', { name: 'Move Root Alpha down' }).click();

  // The swap is order-only (attributes.order), not a rename — Root Alpha
  // still reads "Root Alpha" after the move, just in the second position
  // (top to bottom now — domains stack vertically, not side by side).
  await expect(async () => {
    expect(await domainOrder(page, ['Root Alpha', 'Root Beta'])).toEqual(['Root Beta', 'Root Alpha']);
  }).toPass();

  // --- L2: move Child X down within Root Alpha's own expanded body, swapping with Child Y ---
  await page.getByRole('button', { name: 'Move Child X down' }).click();

  await expect(async () => {
    const l2Order = await page.getByRole('link', { name: /^(Child X|Child Y)$/ }).allTextContents();
    expect(l2Order).toEqual(['Child Y', 'Child X']);
  }).toPass();

  // --- A hand-added capability gets an order at creation, and can be moved immediately ---
  // (the review follow-up that tightened C1: no "not orderable yet" state
  // survives to a freshly-created capability, seeded or hand-added alike).
  await page.getByRole('button', { name: '+ Add capability' }).click();
  await page.getByPlaceholder('Capability name').fill('Hand Added Root');
  // Leave the parent picker at its default ("Top level") — a new L1.
  await page.getByRole('button', { name: 'Add' }).click();

  // Lands after Root Beta and Root Alpha (order 10/21 after the swap above,
  // so the new capability gets 21) — last among the three L1s.
  await expect(async () => {
    expect(await domainOrder(page, ['Root Alpha', 'Root Beta', 'Hand Added Root'])).toEqual(['Root Beta', 'Root Alpha', 'Hand Added Root']);
  }).toPass();

  // Single-open accordion: Root Alpha is still the one open domain (the
  // add action didn't touch which domain is expanded), so the freshly-
  // added "Hand Added Root" needs its own expand click to reach its own
  // move button.
  await page.getByRole('button', { name: /Hand Added Root/ }).click();
  await page.getByRole('button', { name: 'Move Hand Added Root up' }).click();

  await expect(async () => {
    expect(await domainOrder(page, ['Root Alpha', 'Root Beta', 'Hand Added Root'])).toEqual(['Root Beta', 'Hand Added Root', 'Root Alpha']);
  }).toPass();
});

/**
 * S1 item 13: "L3 reorder controls" and "order assigned on the fly when
 * missing" — a separate fixture/test from the one above, since both of
 * these are genuinely new behaviour (the review-tightened C1 above only
 * ever covered L1/L2, and every seeded capability there already had an
 * `order`).
 */
test('reordering: L3 tiles have their own move controls, and a capability with no order swaps in without refusing', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-reorder-l3-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map-reorder-l3 fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map-reorder-l3 fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-reorder-l3-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Reorder L3 Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-reorder-l3-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Reorder L3 Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const midId = randomUUID();
  const leafXId = randomUUID();
  const leafYId = randomUUID();
  // A second L1 whose two children have NO `order` at all — the "order
  // assigned on the fly when missing" case. `noOrderParentId` itself has
  // an order so it doesn't also compete with `rootId` for L1 position.
  const noOrderParentId = randomUUID();
  const noOrderChildAId = randomUUID();
  const noOrderChildBId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed an L1/L2/L3 chain, plus two order-less L2 siblings under a second L1',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'L3 Reorder Root', parentId: null, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: midId, elementType: 'capability', name: 'L3 Reorder Mid', parentId: rootId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: leafXId, elementType: 'capability', name: 'Leaf X', parentId: midId, attributes: { order: 10 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: leafYId, elementType: 'capability', name: 'Leaf Y', parentId: midId, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: noOrderParentId, elementType: 'capability', name: 'No Order Root', parentId: null, attributes: { order: 20 }, sourceId: seedSourceId, confidence: 1 },
      // Deliberately no `order` attribute on either child — simulates a
      // capability that predates create-time order assignment.
      { kind: 'element.create', id: randomUUID(), elementId: noOrderChildAId, elementType: 'capability', name: 'No Order Child A', parentId: noOrderParentId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: noOrderChildBId, elementType: 'capability', name: 'No Order Child B', parentId: noOrderParentId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding capability-map-reorder-l3 fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);
  await expect(page.getByRole('button', { name: /L3 Reorder Root/ })).toBeVisible();
  await page.getByLabel('Reorder mode').check();

  // A domain's own children (and their move buttons) live in its expanded
  // body — expand "L3 Reorder Root" to reach "L3 Reorder Mid".
  await page.getByRole('button', { name: /L3 Reorder Root/ }).click();

  // --- L3: expand L3 Reorder Mid, move Leaf X down, swapping with Leaf Y ---
  await page.getByRole('button', { name: /▸ 2/ }).click();
  await expect(page.getByRole('link', { name: 'Leaf X' })).toBeVisible();
  await page.getByRole('button', { name: 'Move Leaf X down' }).click();

  await expect(async () => {
    const l3Order = await page.getByRole('link', { name: /^(Leaf X|Leaf Y)$/ }).allTextContents();
    expect(l3Order).toEqual(['Leaf Y', 'Leaf X']);
  }).toPass();

  // --- Order assigned on the fly: neither No Order Child has an `order`
  // at all, yet the move button still works, without the old "Both
  // capabilities need an existing order before they can swap places"
  // refusal message ever appearing. --- Single-open accordion: expanding
  // "No Order Root" (a different domain) closes "L3 Reorder Root" again,
  // which is fine — its own checks above are already done.
  await page.getByRole('button', { name: /No Order Root/ }).click();
  await expect(page.getByText('No Order Child A')).toBeVisible();
  await page.getByRole('button', { name: 'Move No Order Child A down' }).click();

  await expect(async () => {
    const noOrderOrder = await page.getByRole('link', { name: /^(No Order Child A|No Order Child B)$/ }).allTextContents();
    expect(noOrderOrder).toEqual(['No Order Child B', 'No Order Child A']);
  }).toPass();
  await expect(page.getByText('Both capabilities need an existing order')).toHaveCount(0);
});
