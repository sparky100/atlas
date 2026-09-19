/**
 * The capability map's core user path (CLAUDE.md's sprint DoD): a
 * two-level tree plus an orphan renders correctly, an L2 card expands to
 * reveal its L3 tile, the orphan is flagged rather than silently dropped,
 * and switching colour-by actually changes a tile's tone. Deferred from
 * Sprint U2 step 1 to this step at the user's own explicit request (see
 * CapabilityMapView.tsx's own module comment) — "the capability map is the
 * first screen a director sees; it should not be the one without an
 * end-to-end test."
 *
 * Same "needs a real Supabase" limitation as e2e/element-edit.spec.ts. No
 * genesis-commit bootstrap any more (ADR-018): main already has a real
 * head — its genesis commit, made by atlas.on_model_created — the instant
 * createModel's insert fires, so this fixture just commits on top of it.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';

test('capability map: two-level tree with an orphan, L2→L3 expand, orphan flagged, colour-by changes a tile\'s tone', async ({ page }) => {
  const env = loadEnv();

  const email = `capmap-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`capability-map fixture sign-in: ${signInError.message}`);

  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`capability-map fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `capmap-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Capability Map Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `capmap-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Capability Map Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;
  if (!genesisCommitId) throw new Error('main branch has no head commit (ADR-018 violation)');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const rootId = randomUUID();
  const l2Id = randomUUID();
  const l3Id = randomUUID();
  const orphanId = randomUUID();
  const systemId = randomUUID();

  const deltas: Delta[] = [
    { kind: 'element.create', id: randomUUID(), elementId: rootId, elementType: 'capability', name: 'Digital Services', parentId: null, attributes: { code: '1' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: l2Id, elementType: 'capability', name: 'Housing', parentId: rootId, attributes: { code: '1.1' }, sourceId: seedSourceId, confidence: 1 },
    { kind: 'element.create', id: randomUUID(), elementId: l3Id, elementType: 'capability', name: 'Repairs', parentId: l2Id, attributes: { code: '1.1.1' }, sourceId: seedSourceId, confidence: 1 },
    // An orphan: parentId names an id that never exists — a broken parent
    // chain (src/ui/capabilityMap/layout.ts's `computeCapabilityMapTree`
    // puts this in `orphans`, not silently under any column).
    { kind: 'element.create', id: randomUUID(), elementId: orphanId, elementType: 'capability', name: 'Orphaned Thing', parentId: randomUUID(), attributes: {}, sourceId: seedSourceId, confidence: 1 },
    {
      kind: 'element.create',
      id: randomUUID(),
      elementId: systemId,
      elementType: 'system',
      name: 'Housing Portal',
      parentId: null,
      attributes: { lifecycleStatus: 'active', isExternal: false },
      sourceId: seedSourceId,
      confidence: 1,
    },
    { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: systemId, toElementId: l2Id, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
  ];

  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a two-level capability tree with an orphan',
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope });
  if (!seedResult.ok) throw new Error(`seeding the capability map fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/capability-map`);

  // Domains are collapsed by default (capability map redesign) — the L1
  // domain itself is visible as a summary row, but its L2 card isn't,
  // until the row is expanded.
  await expect(page.getByRole('button', { name: /Digital Services/ })).toBeVisible();
  await expect(page.getByText('Housing', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Digital Services/ }).click();
  await expect(page.getByText('Housing', { exact: true })).toBeVisible();

  // The orphan is flagged, not silently dropped or misplaced.
  await expect(page.getByText('Orphaned Thing')).toBeVisible();
  await expect(page.getByText(/broken or too-deep parent chain/)).toBeVisible();

  // L3 is collapsed until the L2 card is expanded.
  await expect(page.getByText('Repairs')).toHaveCount(0);
  await page.getByRole('button', { name: /▸\s*1/ }).click();
  await expect(page.getByText('Repairs')).toBeVisible();

  // Colour-by actually changes a tile's tone: no coverage chip once
  // explicitly set to None, a real one (stating the tone in words — the
  // literal count lives in the "→ Landscape" link instead, never
  // duplicated onto this chip too) after switching to Coverage. Starts
  // from an explicit "None" selection, not an assumed default — Sprint
  // U4-1 C4 gives this model a real default colour-by the instant it
  // loads (this fixture's own user owns their org, so home_mode defaults
  // to architect, and coverage is the architect default on a model that
  // already has a system) — this test is about the *switch* working, not
  // about which mode happens to load first.
  await page.getByLabel('Colour by').selectOption({ label: 'None' });
  await expect(page.getByText('supporting systems')).toHaveCount(0);
  await page.getByLabel('Colour by').selectOption({ label: 'Coverage (supporting-system count)' });
  await expect(page.getByText('supporting systems')).toBeVisible();
});
