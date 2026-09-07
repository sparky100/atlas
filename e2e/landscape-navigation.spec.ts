/**
 * The landscape's core navigation path (Sprint H1 item 9's "behavioural
 * landscape spec"): select a system on the canvas, land on its Context
 * view, and see the breadcrumb now name that system — the zoom chain's
 * first real hop (UI-principles §2.1), not exercised by
 * e2e/landscape-perf.spec.ts (which only measures payload size and never
 * loads the page in a browser at all).
 *
 * The canvas is Canvas 2D, not DOM (src/ui/landscape/LandscapeCanvas.tsx's
 * own module comment) — there is no per-node element to click by role or
 * text. This computes the seeded system's real screen position the same
 * way the canvas itself does: `computeLandscapeLayout` (the pure,
 * deterministic layout function the app calls, imported directly here,
 * same technique e2e/landscape-perf.spec.ts already uses for its own
 * fixture) against the identical single-system input, then clicks the
 * canvas at that node's centre. The canvas's transform starts at identity
 * (`{ scale: 1, tx: 0, ty: 0 }`, LandscapeCanvas.tsx's own initial state),
 * so world coordinates are screen coordinates directly, with no fit-to-
 * view step to account for.
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts. No
 * genesis-commit bootstrap (ADR-018): main already has a real head the
 * instant createModel's insert fires.
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

test('selecting a system on the landscape zooms to its Context view and updates the breadcrumb', async ({ page }) => {
  const env = loadEnv();

  const email = `landscapenav-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`landscape-navigation fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`landscape-navigation fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `landscapenav-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Landscape Nav Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `landscapenav-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Landscape Nav Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const systemId = randomUUID();
  const systemName = 'Billing Service';
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    message: 'seed Billing Service',
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: systemId, elementType: 'system', name: systemName, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding Billing Service: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/landscape`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('aria-label', /1 systems/, { timeout: 30_000 });

  // The exact same pure layout function LandscapeCanvas.tsx calls, given
  // the one system this fixture seeded (unassigned lane — no `supports`
  // edge). Deterministic, so this computes the identical node position the
  // browser is about to render.
  const systemRow: ElementsHeadRow = {
    element_id: systemId,
    element_type: 'system',
    name: systemName,
    parent_id: null,
    attributes: { lifecycleStatus: 'active', isExternal: false },
    exists_delta_id: randomUUID(),
  };
  const layout = computeLandscapeLayout([systemRow], [], new Map());
  const node = layout.nodes.find((n) => n.elementId === systemId);
  if (!node) throw new Error('computeLandscapeLayout did not place the seeded system');

  await canvas.click({ position: { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 } });

  await expect(page).toHaveURL(new RegExp(`/context/${systemId}\\?ref=main`));
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  // .first(): the name legitimately appears more than once on this page
  // (e.g. the heading and the breadcrumb below) — this check only cares
  // that it shows up somewhere; the breadcrumb-specific check follows.
  await expect(page.getByText(systemName).first()).toBeVisible();

  // The breadcrumb had no such segment on the landscape page (no capability
  // filter was used, so it showed only Org › Model › [main]) — now it
  // names the system this navigation zoomed into, proof this was a real
  // zoom, not just a page that happens to show the name somewhere.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText(systemName)).toBeVisible();
});
