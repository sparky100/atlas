/**
 * The architect door's Health findings (Handoff 7d's architect-door
 * amendment, `docs/HANDOFF-7d-architect-door.md`, UI-principles §3.2):
 * systems not linked to a capability, capabilities with no owner,
 * attributes stale over `STALE_AFTER_MONTHS`, `uses`/`flows_to`
 * relationships with no verb-phrase label (Sprint U4-1 B5), and the
 * duplicates count (already wired to 0, ADR-019). Seeds a realistic mix
 * through the real `commitToBranch` path from Node (ADR-018 — main already
 * has a genesis commit, no bootstrap needed), then drives the actual UI
 * through the browser.
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

test('architect door: health findings name systems with no capability, capabilities with no owner, and stale attributes', async ({ page }) => {
  const env = loadEnv();

  const email = `healthfindings-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`health-findings fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`health-findings fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `healthfindings-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Health Findings Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `healthfindings-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Health Findings Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const ownedCapabilityId = randomUUID();
  const unownedCapabilityId = randomUUID();
  const ownedSystemId = randomUUID();
  const ownedSystemCreateDeltaId = randomUUID();
  const unownedSystemId = randomUUID(); // supports unownedCapability, but no primary owner
  const orphanSystemId = randomUUID(); // supports nothing at all
  const actorId = randomUUID();
  const consumerSystemId = randomUUID(); // uses ownedSystemId, no label — B5's own finding
  const labeledTargetSystemId = randomUUID(); // uses ownedSystemId too, but labeled — must not be flagged

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed capabilities, systems, an actor, and a stale vendor fact',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: ownedCapabilityId, elementType: 'capability', name: 'Owned Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unownedCapabilityId, elementType: 'capability', name: 'Unowned Capability', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: ownedSystemCreateDeltaId, elementId: ownedSystemId, elementType: 'system', name: 'Well Owned System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unownedSystemId, elementType: 'system', name: 'Unowned System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: orphanSystemId, elementType: 'system', name: 'Orphan System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Housing Digital Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: consumerSystemId, elementType: 'system', name: 'Consumer System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: labeledTargetSystemId, elementType: 'system', name: 'Labeled Consumer System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: ownedSystemId, toElementId: ownedCapabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: unownedSystemId, toElementId: unownedCapabilityId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorId, toElementId: ownedSystemId, attributes: { primary: true }, sourceId: seedSourceId, confidence: 1 },
      // B5: a uses edge with no label (attributes: {}, predating the
      // creation-time requirement — nothing enforces it retroactively) is
      // the finding's own target; a second, labeled one proves the finding
      // doesn't flag every uses edge indiscriminately.
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: consumerSystemId, toElementId: ownedSystemId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'uses', fromElementId: labeledTargetSystemId, toElementId: ownedSystemId, attributes: { description: 'reads billing records from' }, sourceId: seedSourceId, confidence: 1 },
      // A vendor fact over a year old — Unowned System's own "stale attribute".
      {
        kind: 'element.update',
        id: randomUUID(),
        elementId: unownedSystemId,
        elementType: 'system',
        attribute: 'vendor',
        value: 'Legacy Supplier Ltd',
        previousDeltaId: ownedSystemCreateDeltaId,
        sourceId: seedSourceId,
        confidence: 1,
        effectiveDate: '2024-01-01',
      },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding health-findings fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  // The org's creator is its owner, so the default door is already architect.
  await expect(page.getByRole('heading', { name: 'Health findings' })).toBeVisible();

  await expect(page.getByText('1 system not linked to a capability')).toBeVisible();
  await expect(page.getByText('Orphan System', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Review and link/ })).toBeVisible();

  await expect(page.getByText('1 capability with no owner')).toBeVisible();
  await expect(page.getByText('Unowned Capability', { exact: true })).toBeVisible();
  // The owned capability must not appear in the no-owner finding.
  await expect(page.getByText('Owned Capability', { exact: true })).toHaveCount(0);

  await expect(page.getByText('1 attribute stale over 12 months')).toBeVisible();
  await expect(page.getByText(/across 1 system · oldest \dy/)).toBeVisible();

  // Sprint U4-1 B5's finding: exactly the one unlabeled edge, named by its
  // endpoints — the labeled one must not appear here.
  await expect(page.getByText('1 relationship missing a label')).toBeVisible();
  await expect(page.getByText('Consumer System → Well Owned System')).toBeVisible();
  await expect(page.getByText('Labeled Consumer System → Well Owned System')).toHaveCount(0);

  await expect(page.getByText('0 duplicates flagged')).toBeVisible();
});

test('Sprint U4-1 B3: a finding with more than three items collapses to "and N more", expands to the full list, and paginates at 20', async ({ page }) => {
  const env = loadEnv();

  const email = `healthfindings-page-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`health-findings paginate fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`health-findings paginate fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `healthfindings-page-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Health Findings Pagination Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `healthfindings-page-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Health Findings Pagination Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // 22 systems, none linked to any capability — one page's worth (20) plus
  // 2 more, and zero-padded names so alphabetical order is also numeric
  // order (findSystemsWithoutCapability's own input is name-ordered,
  // src/db/landscape.ts's listSystemsForLandscape).
  const systemCount = 22;
  const deltas = Array.from({ length: systemCount }, (_, i) => ({
    kind: 'element.create' as const,
    id: randomUUID(),
    elementId: randomUUID(),
    elementType: 'system' as const,
    name: `System ${String(i + 1).padStart(2, '0')}`,
    parentId: null,
    attributes: { lifecycleStatus: 'active' as const, isExternal: false },
    sourceId: seedSourceId,
    confidence: 1,
  }));

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `seed ${String(systemCount)} unlinked systems`,
    body: null,
    deltas,
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding health-findings pagination fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('22 systems not linked to a capability')).toBeVisible();

  // Collapsed: only the first three, "and 19 more" — not the rest, and no
  // pagination controls yet.
  await expect(page.getByText('System 01, System 02, System 03, and 19 more')).toBeVisible();
  await expect(page.getByText('System 22', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Page \d of \d/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Show all' }).click();

  // Expanded, page 1: every name up to System 20, not System 21/22 yet.
  await expect(page.getByText('System 01', { exact: true })).toBeVisible();
  await expect(page.getByText('System 20', { exact: true })).toBeVisible();
  await expect(page.getByText('System 21', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Page 1 of 2')).toBeVisible();

  await page.getByRole('button', { name: 'Next →' }).click();

  // Page 2: the remaining 2, page 1's own System 01 no longer shown.
  await expect(page.getByText('System 21', { exact: true })).toBeVisible();
  await expect(page.getByText('System 22', { exact: true })).toBeVisible();
  await expect(page.getByText('System 01', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
});

test('Sprint U4-1 B3: capability ownership inherits from an owned ancestor; an unowned subtree lists only its highest unowned ancestor', async ({ page }) => {
  const env = loadEnv();

  const email = `healthfindings-owner-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`health-findings ownership fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`health-findings ownership fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `healthfindings-owner-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Health Findings Ownership Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `healthfindings-owner-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Health Findings Ownership Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const unownedRootId = randomUUID();
  const unownedChildId = randomUUID();
  const ownedRootId = randomUUID();
  const ownedChildId = randomUUID();
  const actorId = randomUUID();

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed an unowned capability subtree and an owned one',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: unownedRootId, elementType: 'capability', name: 'Unowned Root', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: unownedChildId, elementType: 'capability', name: 'Unowned Child', parentId: unownedRootId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: ownedRootId, elementType: 'capability', name: 'Owned Root', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: ownedChildId, elementType: 'capability', name: 'Owned Root Child', parentId: ownedRootId, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: actorId, elementType: 'actor', name: 'Platform Team', parentId: null, attributes: { subtype: 'team', isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      // Directly on the capability (Bug found during B3: owns can target a
      // capability, actor→capability, not only a system) — Owned Root's
      // child inherits this, so neither should be flagged.
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'owns', fromElementId: actorId, toElementId: ownedRootId, attributes: { primary: true }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding health-findings ownership fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByText('1 capability with no owner')).toBeVisible();
  // Only the highest unowned ancestor is listed — its child is implied, not
  // a second entry.
  await expect(page.getByText('Unowned Root', { exact: true })).toBeVisible();
  await expect(page.getByText('Unowned Child', { exact: true })).toHaveCount(0);
  // The owned root's own child inherits ownership and is never flagged.
  await expect(page.getByText('Owned Root', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Owned Root Child', { exact: true })).toHaveCount(0);
});

test('Sprint U4-1 B3: a model with nothing to flag collapses the whole panel to one "No findings" line', async ({ page }) => {
  const env = loadEnv();

  const email = `healthfindings-clean-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`health-findings clean fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`health-findings clean fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `healthfindings-clean-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Health Findings Clean Test Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `healthfindings-clean-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Health Findings Clean Test Model', slug: modelSlug, createdBy: userId });

  // Genesis-only main — a brand-new model has nothing to flag at all
  // (ADR-018: main already has a real head, no bootstrap needed).
  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await expect(page.getByRole('heading', { name: 'Health findings' })).toBeVisible();
  await expect(page.getByText('No findings.')).toBeVisible();
  await expect(page.getByText(/not linked to a capability/)).toHaveCount(0);
  await expect(page.getByText(/with no owner/)).toHaveCount(0);
  await expect(page.getByText(/duplicates flagged/)).toHaveCount(0);
});
