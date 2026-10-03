/**
 * The director door, built to Handoff 7d (`docs/HANDOFF-7d-director-door.md`,
 * UI-principles §3.1): one vertical read — where are we weak, what's
 * changing, what's recent — read-only by construction. Seeds a realistic
 * mix through the real `commitToBranch`/review-queue RPC paths from Node
 * (ADR-018 — main already has a genesis commit, no bootstrap needed), then
 * drives the actual UI through the browser.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CommitEnvelope, Delta, LifecycleStatus } from '../src/contracts/delta';
import { createChangeBranch, getBranch, getMainBranch } from '../src/db/branches';
import { createSupabaseClient } from '../src/db/client';
import { commitToBranch } from '../src/db/commits';
import { createTag } from '../src/db/tags';
import { createModel } from '../src/db/models';
import { createOrganisation } from '../src/db/organisations';
import { loadEnv } from '../src/db/env';
import { addArchitectMember } from './fixtures/changeBranchFixture';

function createSystem(id: string, elementId: string, name: string, lifecycleStatus: LifecycleStatus, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus, isExternal: false }, sourceId, confidence: 1 };
}

test('director door: weakness grid (warn/info/healthy/unrecorded), the changes table, and version stamps', async ({ page }) => {
  const env = loadEnv();

  const email = `directordoor-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`director-door fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`director-door fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `directordoor-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Director Door Test Org', slug: orgSlug, createdBy: userId });

  // F3a's own architect floor (`atlas.submit_merge_request`'s
  // `v_min_architects`, default 1): the propose-intent submit below needs a
  // real reviewer set including an architect — nothing else in this test
  // drives that member's own session (`approve_merge_request`'s own gate,
  // used below, is independent of the reviewer set — just owner/architect
  // role).
  const { userId: architectUserId } = await addArchitectMember(env, orgId, userId);

  const modelId = randomUUID();
  const modelSlug = `directordoor-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Director Door Test Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');
  const genesisCommitId = main.head_commit_id;

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  // Four level-1 capabilities, one of each weakness kind Handoff 7d names.
  const capWarnId = randomUUID();
  const capInfoId = randomUUID();
  const capHealthyId = randomUUID();
  const capUnrecordedId = randomUUID();
  const sysWarnId = randomUUID(); // retiring, no planned replacement -> capWarn is 'warn'
  const sysInfoOldId = randomUUID(); // retiring, replacement planned -> capInfo is 'info'
  const sysInfoOldCreateDeltaId = randomUUID(); // named so the later element.retract can cite it as previousDeltaId
  const sysInfoOldSupportsRelationshipId = randomUUID();
  const sysInfoOldSupportsCreateDeltaId = randomUUID(); // named so the later relationship.retract can cite it as previousDeltaId (C8: an element can't be retracted while a live relationship still references it)
  const sysHealthyId = randomUUID(); // active -> capHealthy is 'ok'

  const seedEnvelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: genesisCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed four capabilities and their systems',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: capWarnId, elementType: 'capability', name: 'Revenues and Benefits', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capInfoId, elementType: 'capability', name: 'Adult Social Care', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capHealthyId, elementType: 'capability', name: 'Waste Collection', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capUnrecordedId, elementType: 'capability', name: 'Electoral Services', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      createSystem(randomUUID(), sysWarnId, 'Northgate Revenues', 'retiring', seedSourceId),
      createSystem(sysInfoOldCreateDeltaId, sysInfoOldId, 'Legacy Case System', 'retiring', seedSourceId),
      createSystem(randomUUID(), sysHealthyId, 'Bartec Collective', 'active', seedSourceId),
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: sysWarnId, toElementId: capWarnId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: sysInfoOldSupportsCreateDeltaId, relationshipId: sysInfoOldSupportsRelationshipId, relationshipType: 'supports', fromElementId: sysInfoOldId, toElementId: capInfoId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: sysHealthyId, toElementId: capHealthyId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: genesisCommitId, envelope: seedEnvelope });
  if (!seedResult.ok) throw new Error(`seeding director-door fixture: ${seedResult.message}`);

  const mainAfterSeed = await getMainBranch(signedIn, modelId);
  if (!mainAfterSeed?.head_commit_id) throw new Error('main branch not found after seed');

  // A first version, tagged right after the seed.
  await createTag(signedIn, { id: randomUUID(), orgId, modelId, name: 'v0.1', commitId: mainAfterSeed.head_commit_id, createdBy: userId });

  // The planned-replacement branch: creates a new system supporting
  // capInfo and retracts the old one, then goes all the way to approved
  // (in delivery, ADR-006) — exactly UI-principles §3.1's rule.
  const replacementBranch = await createChangeBranch(signedIn, { id: randomUUID(), orgId, modelId, name: 'replace-legacy-case-system', createdBy: userId, intent: 'propose', mainHeadCommitId: mainAfterSeed.head_commit_id });
  const sysInfoNewId = randomUUID();
  const replacementResult = await commitToBranch(signedIn, {
    modelId,
    branchId: replacementBranch.id,
    expectedHeadCommitId: replacementBranch.head_commit_id,
    envelope: {
      id: randomUUID(),
      branchId: replacementBranch.id,
      parentCommitId: replacementBranch.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'add the replacement system, retract the old one',
      body: null,
      deltas: [
        createSystem(randomUUID(), sysInfoNewId, 'Modern Case Platform', 'active', seedSourceId),
        { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: sysInfoNewId, toElementId: capInfoId, attributes: { role: 'secondary' }, sourceId: seedSourceId, confidence: 1 },
        // C8: an element can't be retracted while a live relationship still
        // references it — retract the old system's own supports edge first.
        { kind: 'relationship.retract', id: randomUUID(), relationshipId: sysInfoOldSupportsRelationshipId, relationshipType: 'supports', previousDeltaId: sysInfoOldSupportsCreateDeltaId, sourceId: seedSourceId, confidence: 1 },
        { kind: 'element.retract', id: randomUUID(), elementId: sysInfoOldId, elementType: 'system', previousDeltaId: sysInfoOldCreateDeltaId, sourceId: seedSourceId, confidence: 1 },
      ],
    },
  });
  if (!replacementResult.ok) throw new Error(`replacement branch commit failed: ${replacementResult.message}`);

  const requestId = randomUUID();
  const { error: submitError } = await signedIn.schema('atlas').rpc('submit_merge_request', { p_id: requestId, p_branch_id: replacementBranch.id, p_classification: { hasBlockingConflict: false }, p_reviewers: [{ user_id: architectUserId, required: true }] });
  if (submitError) throw new Error(`submit_merge_request: ${submitError.message}`);
  const { error: approveError } = await signedIn.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: requestId });
  if (approveError) throw new Error(`approve_merge_request: ${approveError.message}`);

  // Advance main (so the second tag differs from the first, and shows a
  // non-zero "commits since previous tag"), then tag it.
  const mainAdvance = await commitToBranch(signedIn, {
    modelId,
    branchId: mainAfterSeed.id,
    expectedHeadCommitId: mainAfterSeed.head_commit_id,
    envelope: {
      id: randomUUID(),
      branchId: mainAfterSeed.id,
      parentCommitId: mainAfterSeed.head_commit_id,
      mergedBranchHeadCommitId: null,
      kind: 'manual',
      title: 'a further commit before the second tag',
      body: null,
      deltas: [createSystem(randomUUID(), randomUUID(), 'An Unrelated System', 'active', seedSourceId)],
    },
  });
  if (!mainAdvance.ok) throw new Error(`main advance failed: ${mainAdvance.message}`);
  const mainAfterAdvance = await getMainBranch(signedIn, modelId);
  if (!mainAfterAdvance?.head_commit_id) throw new Error('main branch not found after advance');
  await createTag(signedIn, { id: randomUUID(), orgId, modelId, name: 'v0.2', commitId: mainAfterAdvance.head_commit_id, createdBy: userId });

  // An open change with a target date, for "What's changing".
  const targetDate = '2026-12-01';
  await createChangeBranch(signedIn, { id: randomUUID(), orgId, modelId, name: 'upcoming-change', title: 'Upcoming change', createdBy: userId, intent: 'propose', mainHeadCommitId: mainAfterAdvance.head_commit_id, targetDate });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  // The org's creator is its owner, so the default door is architect —
  // switch to director.
  await page.getByRole('button', { name: 'Overview' }).click();

  await expect(page.getByRole('heading', { name: 'Where are we weak' })).toBeVisible();
  // Two capabilities are exposed (warn + info both count), one has
  // nothing recorded.
  await expect(page.getByText('2 capabilities exposed')).toBeVisible();
  await expect(page.getByText('1 with nothing recorded')).toBeVisible();

  const revenuesTile = page.getByRole('link', { name: /Revenues and Benefits/ });
  await expect(revenuesTile).toBeVisible();
  await expect(revenuesTile.getByText('lifecycle exposure')).toBeVisible();
  await expect(revenuesTile.getByText('Northgate Revenues')).toBeVisible();

  const socialCareTile = page.getByRole('link', { name: /Adult Social Care/ });
  await expect(socialCareTile).toBeVisible();
  await expect(socialCareTile.getByText('replacement planned')).toBeVisible();

  await expect(page.getByRole('link', { name: /Waste Collection/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Electoral Services/ })).toBeVisible();

  // What's changing: the open branch, its target date, right-aligned
  // monospace, sorted to the top since it's the only row with a date.
  await expect(page.getByRole('heading', { name: "What's changing" })).toBeVisible();
  const changeRow = page.getByRole('row', { name: /Upcoming change/ });
  await expect(changeRow).toBeVisible();
  // A real target date renders (year visible, timezone/locale-formatting
  // details aside), not the '—' placeholder an absent one would show.
  await expect(changeRow.getByText('2026')).toBeVisible();
  await expect(changeRow.getByText('—', { exact: true })).toHaveCount(0);

  // What's recent: two versions, the newer one showing a non-zero commits-
  // since-previous-tag count computed from commits.depth, no diff walk.
  await expect(page.getByRole('heading', { name: "What's recent" })).toBeVisible();
  await expect(page.getByRole('link', { name: /v0\.2/ })).toBeVisible();
  await expect(page.getByText(/commits since previous tag/)).toBeVisible();
  await expect(page.getByRole('link', { name: /v0\.1/ })).toBeVisible();

  // Read-only by construction: no add/edit control anywhere on this door.
  await expect(page.getByRole('button', { name: /^Add/ })).toHaveCount(0);

  // The branch used earlier in this test was a stand-in fixture only —
  // confirm it wasn't left mid-review by checking its final status.
  const finalReplacementBranch = await getBranch(signedIn, replacementBranch.id);
  expect(finalReplacementBranch?.status).toBe('approved');
});

/**
 * Bug fix: a capability supported only by a container (a platform's own
 * module, S1 item 20 — a module can `supports` a capability directly, the
 * same as a system) used to read as "nothing recorded" here —
 * `useDirectorHome.ts` only fetched `system`-type elements into the map
 * `buildCapabilityTiles`/`computeExposureTone` (`src/db/modelHome.ts`)
 * look supporters up in, so a container supporter's own edge was silently
 * dropped even though the capability's own element page showed the real
 * relationship.
 */
test('director door: a capability supported only by a container (a platform module) is not "nothing recorded"', async ({ page }) => {
  const env = loadEnv();

  const email = `directordoorcontainer-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`director-door container fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`director-door container fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `directordoorcontainer-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Director Door Container Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `directordoorcontainer-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Director Door Container Model', slug: modelSlug, createdBy: userId });

  const main = await getMainBranch(signedIn, modelId);
  if (!main) throw new Error('main branch was not auto-created');

  const { error: sourceError } = await signedIn.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'manual', name: 'Seed', user_id: userId, created_by: userId });
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  const { data: sourceRow } = await signedIn.from('sources').select('id').eq('model_id', modelId).eq('user_id', userId).single();
  const seedSourceId = (sourceRow as { id: string }).id;

  const platformId = randomUUID();
  const crmId = randomUUID(); // the container — a platform's own module, not a system
  const capabilityId = randomUUID();
  const envelope: CommitEnvelope = {
    id: randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: 'seed a platform with a module that supports a capability directly',
    body: null,
    deltas: [
      { kind: 'element.create', id: randomUUID(), elementId: platformId, elementType: 'system', name: 'Dynamics 365', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, kind: 'platform' }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: crmId, elementType: 'container', name: 'CRM', parentId: platformId, attributes: { isExternal: false }, sourceId: seedSourceId, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Customer Contact', parentId: null, attributes: {}, sourceId: seedSourceId, confidence: 1 },
      { kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType: 'supports', fromElementId: crmId, toElementId: capabilityId, attributes: { role: 'primary' }, sourceId: seedSourceId, confidence: 1 },
    ],
  };
  const seedResult = await commitToBranch(signedIn, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!seedResult.ok) throw new Error(`seeding director-door container fixture: ${seedResult.message}`);

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('button', { name: 'Overview' }).click();

  await expect(page.getByRole('heading', { name: 'Where are we weak' })).toBeVisible();
  const tile = page.getByRole('link', { name: /Customer Contact/ });
  await expect(tile).toBeVisible();
  await expect(tile.getByText('1 system')).toBeVisible();
  await expect(tile.getByText('no known supporters')).toHaveCount(0);
  await expect(page.getByText('1 with nothing recorded')).toHaveCount(0);
});

test('director door: the empty-model state offers the real starter-map picker, not a hard-coded sector list', async ({ page }) => {
  const env = loadEnv();

  const email = `directordoorempty-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();

  const signedIn = createSupabaseClient(env);
  const { error: signInError } = await signedIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`director-door empty fixture sign-in: ${signInError.message}`);
  const { data: userData, error: getUserError } = await signedIn.auth.getUser();
  if (getUserError) throw new Error(`director-door empty fixture: could not read the signed-in user: ${getUserError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const orgSlug = `directordoorempty-${orgId.slice(0, 8)}`;
  await createOrganisation(signedIn, { id: orgId, name: 'Director Door Empty Org', slug: orgSlug, createdBy: userId });

  const modelId = randomUUID();
  const modelSlug = `directordoorempty-model-${modelId.slice(0, 8)}`;
  await createModel(signedIn, { id: modelId, orgId, name: 'Director Door Empty Model', slug: modelSlug, createdBy: userId });

  await page.goto(`/o/${orgSlug}/m/${modelSlug}`);
  await page.getByRole('button', { name: 'Overview' }).click();

  await expect(page.getByRole('heading', { name: 'The map is empty' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();
});
