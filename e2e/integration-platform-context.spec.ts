/**
 * Integration platform context: for a `kind: 'integration_platform'`
 * system, the Context view renders every `uses`/`flows_to` edge naming it
 * as `via` as its own content — the platform tile centred, sources on the
 * left, targets on the right, each flow drawn source → platform → target
 * (`IntegrationPlatformDiagramCanvas.tsx`, `integrationPlatformContextLayout.ts`).
 *
 * Same "Canvas 2D, not DOM" technique every other context/landscape e2e
 * spec here uses for the diagram's own geometry claims
 * (`e2e/context-inspector.spec.ts`'s own module comment has the full
 * reasoning): `computeIntegrationPlatformContextLayout`, the real,
 * deterministic layout function the app itself calls, run directly
 * against the seeded ids. The below-canvas "Flows via this platform" list
 * (`PlatformFlowsSection.tsx`, reused verbatim from the element page) is
 * asserted through the DOM as usual, since that part is a plain list, not
 * a canvas.
 *
 * Same "needs a real Supabase" limitation as every other Playwright spec
 * here.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope } from '../src/contracts/delta';
import { getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { computeIntegrationPlatformContextLayout } from '../src/ui/context/integrationPlatformContextLayout';

test('integration platform context: two sources sharing one target, both via-flows routed through the platform, labels attached', async ({ page }) => {
  const env = loadEnv();

  const email = `intplatformctx-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`integration-platform-context fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`integration-platform-context fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `intplatformctx-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Integration Platform Context Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `intplatformctx-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Integration Platform Context Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const platformId = randomUUID();
  const systemAId = randomUUID();
  const systemBId = randomUUID();
  const systemCId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed an integration platform and two via-flows into a shared target',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: platformId, elementType: 'system', name: 'Enterprise Bus', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'integration_platform' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemAId, elementType: 'system', name: 'Ordering System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemBId, elementType: 'system', name: 'Billing System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: systemCId, elementType: 'system', name: 'CRM System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: systemAId, toElementId: systemBId, attributes: { description: 'sends order confirmations to', via: platformId }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'flows_to', fromElementId: systemCId, toElementId: systemBId, attributes: { description: 'sends customer updates to', via: platformId }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding integration-platform-context fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}/context/${platformId}`);
  await expect(page.getByText('Enterprise Bus', { exact: true }).first()).toBeVisible();

  // Header: "N flows via this platform · M sources · K targets".
  await expect(page.getByText('2 flows via this platform')).toBeVisible();
  await expect(page.getByText('2 sources')).toBeVisible();
  await expect(page.getByText('1 target')).toBeVisible();

  // The canvas itself — its own aria-label names the same two counts.
  const canvas = page.getByRole('img', { name: /Integration platform diagram: Enterprise Bus, 2 sources and 1 targets/ });
  await expect(canvas).toBeVisible();

  // The real, deterministic layout function the app itself calls, run
  // directly against the seeded ids — both via-flows route through the
  // platform, grouped into two sources and one shared target, each
  // carrying its own verb label.
  const layout = computeIntegrationPlatformContextLayout(
    platformId,
    [systemAId, systemCId],
    [systemBId],
    [
      { id: 'e1', sourceId: systemAId, targetId: systemBId, verbLabel: 'sends order confirmations to', classificationLabel: null, crossesBoundary: false },
      { id: 'e2', sourceId: systemCId, targetId: systemBId, verbLabel: 'sends customer updates to', classificationLabel: null, crossesBoundary: false },
    ],
  );
  expect(layout.sources.map((t) => t.elementId).sort()).toEqual([systemAId, systemCId].sort());
  expect(layout.targets.map((t) => t.elementId)).toEqual([systemBId]);
  expect(layout.edges).toHaveLength(2);
  for (const edge of layout.edges) {
    expect(edge.sourceSegment.at(-1)?.x).toBe(layout.hub.x);
    expect(edge.targetSegment[0]?.x).toBe(layout.hub.x + layout.hub.w);
  }
  expect(layout.edges.map((e) => e.verbLabel).sort()).toEqual(['sends customer updates to', 'sends order confirmations to']);

  // The below-canvas "Flows via this platform" list — same component the
  // element page's own section already uses — names every source, the
  // shared target, and each flow's own verb, with labels attached to the
  // right edge.
  await page.getByRole('button', { name: 'Flows via this platform' }).click();
  await expect(page.getByText('Ordering System', { exact: true })).toBeVisible();
  await expect(page.getByText('CRM System', { exact: true })).toBeVisible();
  await expect(page.getByText('Billing System', { exact: true })).toHaveCount(2); // once per flow row
  await expect(page.getByText('“sends order confirmations to”')).toBeVisible();
  await expect(page.getByText('“sends customer updates to”')).toBeVisible();
});
