/**
 * Integration tests against a local Supabase (`pnpm db:start` first, or the
 * CI "database" job, which starts one automatically — see
 * .github/workflows/ci.yml). Exercises the real auth flow real users go
 * through: a service-role client creates test accounts, each signs in for
 * real (password auth), and every subsequent request goes through RLS
 * exactly as a production request would — no session shortcuts.
 *
 * This file could not be run inside the authoring sandbox: this sandbox's
 * network policy blocks the Docker Hub pulls `supabase start` needs (see
 * README.md's setup notes and Sprint F1 step 1's summary), so there is no
 * running GoTrue/PostgREST to hit here. The underlying SQL this test
 * depends on — the branch-head compare-and-swap, the
 * atlas.guard_branch_head_advance trigger, RLS on every table touched —
 * was separately rehearsed by hand against a plain local Postgres with a
 * minimal auth shim (the same technique used for every prior migration in
 * this sprint). This file is what actually proves the real thing end to
 * end, starting with the first CI run on this branch.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { foldFromGenesis, headHash } from '../engine/head';
import { serializeHeadProjection } from '../engine/projection';
import { createChangeBranch, getBranch, getMainBranch, listBranchesForModel, updateBranchMetadata } from './branches';
import { resolveBranchModeProjection } from './branchProjection';
import { listCapabilityMapItems } from './capabilityMapTemplates';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { buildCommitLoader } from './commitLoader';
import { commitToBranch } from './commits';
import { createModel, getModelBySlug, listModelsForOrg } from './models';
import { loadEnv } from './env';
import { createOrganisation, getMyMembership, getOrganisationBySlug, listOrganisationsForUser } from './organisations';
import { rebuildHead } from './rebuildHead';
import { seedModelFromCapabilityMap } from './seedFromMap';
import { getOrCreateManualSource } from './sources';
import { createTag, listTagsForModel } from './tags';
import { getUserPreferences, upsertUserPreferences } from './userPreferences';
import { publishCapabilityMap } from '../../scripts/publishCapabilityMap';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
  client: Client;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);

  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);

  return { id: created.user.id, email, client: signIn };
}

// sourceId must be a real `sources` row id (deltas.source_id is uuid, not
// null, cast straight through by atlas.commit_deltas — see
// getOrCreateManualSource below) — never the source *kind* string 'manual'.
function makeCreateDelta(id: string, elementId: string, name: string, sourceId: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 };
}

describe('repository layer against a real local Supabase', () => {
  let alice: TestUser;
  let bob: TestUser;
  let orgId: string;
  let orgSlug: string;
  let modelId: string;
  let modelSlug: string;
  let mainGenesisCommitId: string;
  let capabilityMapId: string;
  let aliceManualSourceId: string;

  beforeAll(async () => {
    alice = await createSignedInUser('alice');
    bob = await createSignedInUser('bob');

    orgId = randomUUID();
    orgSlug = `test-council-${orgId.slice(0, 8)}`;
    // Through src/db/organisations.ts, not a raw insert — Sprint U1 step 2's
    // repository layer is exactly what real app code calls.
    await createOrganisation(alice.client, { id: orgId, name: 'Test Council', slug: orgSlug, createdBy: alice.id });

    modelId = randomUUID();
    modelSlug = `test-landscape-${modelId.slice(0, 8)}`;
    await createModel(alice.client, { id: modelId, orgId, name: 'Test Landscape', slug: modelSlug, createdBy: alice.id });

    // makeCreateDelta's deltas need a real `sources` row (deltas.source_id
    // is uuid, not the source *kind* string 'manual') — the same
    // getOrCreateManualSource every editing hook calls (src/ui/elements/
    // useElementEditor.ts and friends).
    const manualSource = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId, modelId, userId: alice.id });
    aliceManualSourceId = manualSource.id;

    // A minimal published capability map, inserted as service_role —
    // standing in for scripts/loadCapabilityMaps.ts, which is the one that
    // really writes these tables (RLS grants authenticated select only).
    // Two levels, so the genesis seed below actually exercises parent
    // linking, not just a single root.
    capabilityMapId = randomUUID();
    const rootItemId = randomUUID();
    const childItemId = randomUUID();
    // Draft first, items second, published last — capability_map_items_guard_immutable
    // (20260906190000_capability_map_items_immutable_once_published.sql)
    // rejects any item write once the map is published, matching the real
    // draft → load items → publish order scripts/loadCapabilityMaps.ts and
    // scripts/publishCapabilityMap.ts actually use.
    const { error: mapError } = await service.from('capability_maps').insert({ id: capabilityMapId, sector: 'public_body', version: 1, status: 'draft', source_description: 'Integration test fixture' });
    if (mapError) throw new Error(`capability_maps fixture: ${mapError.message}`);
    const { error: itemsError } = await service.from('capability_map_items').insert([
      { id: rootItemId, map_id: capabilityMapId, code: '1', parent_code: null, name: 'Root Capability', description: 'Top-level fixture capability.', level: 1 },
      { id: childItemId, map_id: capabilityMapId, code: '1.1', parent_code: '1', name: 'Child Capability', description: 'Second-level fixture capability.', level: 2 },
    ]);
    if (itemsError) throw new Error(`capability_map_items fixture: ${itemsError.message}`);
    const { error: publishError } = await service.from('capability_maps').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', capabilityMapId);
    if (publishError) throw new Error(`capability_maps fixture publish: ${publishError.message}`);

    // Main's genesis commit through the real tailoring-flow "import" path
    // (Sprint U2 step 2), replacing the former service-role stand-in insert
    // this beforeAll used before atlas.seed_from_map existed.
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');
    const items = await listCapabilityMapItems(alice.client, capabilityMapId);
    const seedResult = await seedModelFromCapabilityMap(alice.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      authorId: alice.id,
      capabilityMapId,
      sector: 'public_body',
      version: 1,
      items,
    });
    if (!seedResult.ok) throw new Error(`seedModelFromCapabilityMap: ${seedResult.message}`);
    mainGenesisCommitId = seedResult.commitId;
  });

  afterAll(async () => {
    // Fresh CI databases don't need this, but a developer re-running
    // against a persistent local `supabase start` does. If beforeAll threw
    // before assigning alice/bob, that failure is already the one that
    // matters; this is best-effort cleanup, not itself under test.
    await service.from('organisations').delete().eq('id', orgId);
    await service.auth.admin.deleteUser(alice.id);
    await service.auth.admin.deleteUser(bob.id);
  });

  it("alice becomes the organisation's owner automatically", async () => {
    const { data, error } = await alice.client.from('members').select('role').eq('org_id', orgId).eq('user_id', alice.id).single();
    expect(error).toBeNull();
    expect(data?.role).toBe('owner');
  });

  it('bob (not a member) sees none of it', async () => {
    expect(await getBranch(bob.client, mainGenesisCommitId)).toBeNull();
    expect(await listBranchesForModel(bob.client, modelId)).toEqual([]);
  });

  // Sprint U2 step 2: atlas.seed_from_map, exercised for real by this
  // file's own beforeAll (see above). RT-4 (SPEC-data-model.md §9's
  // round-trip suite): every seeded element carries attributes.templateRef
  // and a template_code alias, and the seed itself is provenance-recorded
  // as a `sources` row of kind template.
  describe('atlas.seed_from_map / capability-map import (Sprint U2 step 2, RT-4)', () => {
    it('seeds one capability element per map item, correctly parented', async () => {
      const { data: elementsHead, error } = await service
        .from('elements_head')
        .select('element_id, name, parent_id, attributes')
        .eq('commit_id', mainGenesisCommitId)
        .eq('element_type', 'capability');
      if (error) throw new Error(`reading elements_head: ${error.message}`);
      expect(elementsHead).toHaveLength(2);

      const root = elementsHead.find((r) => r.name === 'Root Capability');
      const child = elementsHead.find((r) => r.name === 'Child Capability');
      expect(root?.parent_id).toBeNull();
      expect(child?.parent_id).toBe(root?.element_id);
    });

    it('every seeded element has attributes.code/templateRef and a matching template_code alias (RT-4)', async () => {
      const { data: elementsHead, error } = await service
        .from('elements_head')
        .select('element_id, attributes')
        .eq('commit_id', mainGenesisCommitId)
        .eq('element_type', 'capability');
      if (error) throw new Error(`reading elements_head: ${error.message}`);

      const { data: aliasRows, error: aliasError } = await service.from('aliases').select('element_id, alias_value, alias_type').eq('model_id', modelId);
      if (aliasError) throw new Error(`reading aliases: ${aliasError.message}`);

      for (const row of elementsHead) {
        const attrs = row.attributes as { code: string; templateRef: string };
        expect(attrs.code).toEqual(expect.any(String));
        expect(attrs.templateRef).toEqual(expect.any(String));
        expect(aliasRows).toContainEqual({ element_id: row.element_id, alias_value: attrs.code, alias_type: 'template_code' });
      }
    });

    it("every seeded element's attributes.description matches the map item's own description (Bug A2)", async () => {
      const { data: elementsHead, error } = await service
        .from('elements_head')
        .select('name, attributes')
        .eq('commit_id', mainGenesisCommitId)
        .eq('element_type', 'capability');
      if (error) throw new Error(`reading elements_head: ${error.message}`);

      const expectedDescriptionByName: Record<string, string> = {
        'Root Capability': 'Top-level fixture capability.',
        'Child Capability': 'Second-level fixture capability.',
      };
      expect(elementsHead).toHaveLength(Object.keys(expectedDescriptionByName).length);
      for (const row of elementsHead) {
        const attrs = row.attributes as { description?: string };
        expect(attrs.description).toBe(expectedDescriptionByName[row.name as string]);
      }
    });

    it('records provenance as a `sources` row of kind template, pointing at the capability map used', async () => {
      const { data: sourceRows, error } = await service.from('sources').select('kind, capability_map_id').eq('model_id', modelId).eq('kind', 'template');
      if (error) throw new Error(`reading sources: ${error.message}`);
      expect(sourceRows).toEqual([{ kind: 'template', capability_map_id: capabilityMapId }]);
    });

    it('a second seed attempt on an already-seeded model is rejected (a model is seeded at most once, SPEC §5.1)', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main) throw new Error('main branch not found');
      const items = await listCapabilityMapItems(alice.client, capabilityMapId);
      const result = await seedModelFromCapabilityMap(alice.client, {
        modelId,
        branchId: main.id,
        expectedHeadCommitId: main.head_commit_id,
        authorId: alice.id,
        capabilityMapId,
        sector: 'public_body',
        version: 1,
        items,
      });
      expect(result.ok).toBe(false);
    });

    // 20260906370000_seed_from_map_parent_commit_fix.sql: seed_from_map used
    // to hardcode `parent_commit_id = null` for its own commit — main's head
    // is never null (ADR-018), so branches_guard_head_advance rejected the
    // resulting `update branches set head_commit_id = ...` on every real
    // attempt (masked until 20260906360000's genesis-check fix let a real
    // seed reach this far for the first time). This exercises the real fix
    // end to end: a fresh model's own genesis-only main (not the shared
    // `modelId` fixture above, already past genesis by this point in the
    // suite), then an ordinary follow-on commit on top of the freshly
    // seeded result — "later tailoring is ordinary manual commits on top of
    // this one" (seed_from_map's own comment), now that the model already
    // has commits of its own. Both must succeed, and both must leave
    // main's materialised head exactly matching fold(deltas) from genesis
    // (SPEC §6.6).
    it('seeds a genesis-only model, then takes an ordinary commit on top — both succeed, main advances correctly, and head == fold both times', async () => {
      const freshOrgId = randomUUID();
      await createOrganisation(alice.client, { id: freshOrgId, name: 'Fresh Seed Test Org', slug: `fresh-seed-${freshOrgId.slice(0, 8)}`, createdBy: alice.id });
      const freshModelId = randomUUID();
      await createModel(alice.client, { id: freshModelId, orgId: freshOrgId, name: 'Fresh Seed Test Model', slug: `fresh-seed-model-${freshModelId.slice(0, 8)}`, createdBy: alice.id });

      const mainBeforeSeed = await getMainBranch(alice.client, freshModelId);
      if (!mainBeforeSeed) throw new Error('main branch was not auto-created');
      const genesisCommitId = mainBeforeSeed.head_commit_id;
      const { data: genesisRow, error: genesisError } = await service.from('commits').select('kind').eq('id', genesisCommitId).single();
      if (genesisError) throw new Error(`reading genesis commit: ${genesisError.message}`);
      expect(genesisRow.kind).toBe('genesis');

      // --- seed into a fresh model (genesis only) ---
      const freshItems = await listCapabilityMapItems(alice.client, capabilityMapId);
      const seedResult = await seedModelFromCapabilityMap(alice.client, {
        modelId: freshModelId,
        branchId: mainBeforeSeed.id,
        expectedHeadCommitId: genesisCommitId,
        authorId: alice.id,
        capabilityMapId,
        sector: 'public_body',
        version: 1,
        items: freshItems,
      });
      if (!seedResult.ok) throw new Error(`seedModelFromCapabilityMap on a fresh model: ${seedResult.message}`);

      const { data: seedCommitRow, error: seedCommitError } = await service.from('commits').select('parent_commit_id, depth').eq('id', seedResult.commitId).single();
      if (seedCommitError) throw new Error(`reading seed commit: ${seedCommitError.message}`);
      // The regression this test guards against, directly: the seed
      // commit's own parent must be the real genesis commit, never null.
      expect((seedCommitRow as { parent_commit_id: string | null }).parent_commit_id).toBe(genesisCommitId);
      expect((seedCommitRow as { depth: number }).depth).toBe(1);

      const mainAfterSeed = await getMainBranch(alice.client, freshModelId);
      if (!mainAfterSeed) throw new Error('main branch not found after seeding');
      expect(mainAfterSeed.head_commit_id).toBe(seedResult.commitId);

      const loaderAfterSeed = await buildCommitLoader(service, freshModelId);
      const expectedHeadAfterSeed = foldFromGenesis(seedResult.commitId, loaderAfterSeed);
      const rebuildAfterSeed = await rebuildHead(service, freshModelId);
      expect(rebuildAfterSeed.headHash).toBe(headHash(expectedHeadAfterSeed));

      // --- an ordinary commit into a model that already has commits ---
      // (the seed above, on top of genesis) — the same commitToBranch path
      // every real edit uses, verifying the parent-chain fix here didn't
      // disturb the branch's own ordinary advance.
      const freshManualSource = await getOrCreateManualSource(alice.client, { id: randomUUID(), orgId: freshOrgId, modelId: freshModelId, userId: alice.id });
      const newElementId = randomUUID();
      const tailoringResult = await commitToBranch(alice.client, {
        modelId: freshModelId,
        branchId: mainAfterSeed.id,
        expectedHeadCommitId: seedResult.commitId,
        envelope: {
          id: randomUUID(),
          branchId: mainAfterSeed.id,
          parentCommitId: seedResult.commitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: 'add a system by hand',
          body: null,
          deltas: [makeCreateDelta(randomUUID(), newElementId, 'Hand-Added System', freshManualSource.id)],
        },
      });
      if (!tailoringResult.ok) throw new Error(`commitToBranch after seeding: ${tailoringResult.message}`);

      const mainAfterTailoring = await getMainBranch(alice.client, freshModelId);
      expect(mainAfterTailoring?.head_commit_id).toBe(tailoringResult.commitId);

      const loaderAfterTailoring = await buildCommitLoader(service, freshModelId);
      const expectedHeadAfterTailoring = foldFromGenesis(tailoringResult.commitId, loaderAfterTailoring);
      const rebuildAfterTailoring = await rebuildHead(service, freshModelId);
      expect(rebuildAfterTailoring.headHash).toBe(headHash(expectedHeadAfterTailoring));

      await service.from('organisations').delete().eq('id', freshOrgId);
    });
  });

  it('alice forks a change branch and commits to it successfully', async () => {
    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: 'add-a-system',
      createdBy: alice.id,
      mainHeadCommitId: mainGenesisCommitId,
    });
    expect(branch.status).toBe('draft');
    expect(branch.head_commit_id).toBe(mainGenesisCommitId);

    const elementId = randomUUID();
    const result = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: {
        id: randomUUID(),
        branchId: branch.id,
        parentCommitId: mainGenesisCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'add Housing Options',
        body: null,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Housing Options', aliceManualSourceId)],
      },
    });
    expect(result).toMatchObject({ ok: true });

    const updated = await getBranch(alice.client, branch.id);
    expect(updated?.head_commit_id).toBe(result.ok ? result.commitId : undefined);
  });

  it('a second commit against the SAME stale expected head loses the race (optimistic concurrency)', async () => {
    const branch = await createChangeBranch(alice.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: 'concurrency-check',
      createdBy: alice.id,
      mainHeadCommitId: mainGenesisCommitId,
    });

    const buildEnvelope = (name: string) => ({
      id: randomUUID(),
      branchId: branch.id,
      parentCommitId: mainGenesisCommitId,
      mergedBranchHeadCommitId: null,
      kind: 'manual' as const,
      title: name,
      body: null,
      deltas: [makeCreateDelta(randomUUID(), randomUUID(), name, aliceManualSourceId)],
    });

    const first = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: buildEnvelope('First commit'),
    });
    expect(first.ok).toBe(true);

    // Same expectedHeadCommitId as `first` used — but the branch has
    // already moved past it. This is exactly what a second browser tab, or
    // a stale in-memory head, would send.
    const second = await commitToBranch(alice.client, {
      modelId,
      branchId: branch.id,
      expectedHeadCommitId: mainGenesisCommitId,
      envelope: buildEnvelope('Second, conflicting commit'),
    });
    expect(second).toMatchObject({ ok: false, reason: 'conflict' });

    // The branch head reflects only the winner.
    const finalBranch = await getBranch(alice.client, branch.id);
    expect(finalBranch?.head_commit_id).toBe(first.ok ? first.commitId : undefined);
  });

  it('alice tags the main genesis commit; bob still cannot see it', async () => {
    const tag = await createTag(alice.client, { id: randomUUID(), orgId, modelId, name: 'v1', commitId: mainGenesisCommitId, createdBy: alice.id });
    expect(tag.commit_id).toBe(mainGenesisCommitId);
    expect(await listTagsForModel(bob.client, modelId)).toEqual([]);
  });

  // Sprint U1 step 2: organisations/models repository, the org switcher and
  // model list's actual data source.
  it('alice lists her own organisation and resolves it by slug; bob sees neither', async () => {
    const aliceOrgs = await listOrganisationsForUser(alice.client);
    expect(aliceOrgs.map((o) => o.id)).toContain(orgId);
    expect(await getOrganisationBySlug(alice.client, orgSlug)).toMatchObject({ id: orgId });

    const bobOrgs = await listOrganisationsForUser(bob.client);
    expect(bobOrgs.map((o) => o.id)).not.toContain(orgId);
    expect(await getOrganisationBySlug(bob.client, orgSlug)).toBeNull();
  });

  it('alice lists her model and resolves it by slug; bob sees neither', async () => {
    const aliceModels = await listModelsForOrg(alice.client, orgId);
    expect(aliceModels.map((m) => m.id)).toContain(modelId);
    expect(await getModelBySlug(alice.client, orgId, modelSlug)).toMatchObject({ id: modelId });

    // Bob isn't a member, so RLS hides the org's models from him entirely —
    // listModelsForOrg(bob.client, orgId) returns [], not an error.
    expect(await listModelsForOrg(bob.client, orgId)).toEqual([]);
    expect(await getModelBySlug(bob.client, orgId, modelSlug)).toBeNull();
  });

  it("a contributor cannot create a model (mirrors models_insert's RLS, which is the real gate)", async () => {
    // Promote bob to contributor on alice's org so this actually exercises
    // "wrong role", not "not a member at all" (already covered above).
    const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
    if (inviteError) throw new Error(`inviting bob as contributor: ${inviteError.message}`);

    await expect(createModel(bob.client, { id: randomUUID(), orgId, name: 'Should not exist', slug: `nope-${randomUUID().slice(0, 8)}`, createdBy: bob.id })).rejects.toThrow();

    const { error: removeError } = await alice.client.from('members').delete().eq('org_id', orgId).eq('user_id', bob.id);
    if (removeError) throw new Error(`removing bob: ${removeError.message}`);
  });

  it("alice's own membership row reports her role; a non-member's lookup finds nothing", async () => {
    const aliceMembership = await getMyMembership(alice.client, orgId, alice.id);
    expect(aliceMembership?.role).toBe('owner');
    expect(await getMyMembership(bob.client, orgId, bob.id)).toBeNull();
  });

  // Sprint U1 step 2a: user_preferences.
  describe('user_preferences', () => {
    it('has no row until the first change (SPEC §3.2)', async () => {
      expect(await getUserPreferences(alice.client, alice.id)).toBeNull();
    });

    it('is created by the first upsert, and updated by the next one', async () => {
      const created = await upsertUserPreferences(alice.client, { userId: alice.id, theme: 'dark' });
      expect(created).toMatchObject({ user_id: alice.id, theme: 'dark', density: 'comfortable', home_mode: 'director' });

      const updated = await upsertUserPreferences(alice.client, { userId: alice.id, density: 'compact' });
      // theme survives the second upsert untouched — this is a merge, not a replace.
      expect(updated).toMatchObject({ user_id: alice.id, theme: 'dark', density: 'compact' });
    });

    it("bob cannot read alice's preferences, and cannot write a row under her id (RLS is user-scoped, not org-scoped)", async () => {
      expect(await getUserPreferences(bob.client, alice.id)).toBeNull();
      await expect(upsertUserPreferences(bob.client, { userId: alice.id, theme: 'light' })).rejects.toThrow();
    });
  });

  // Sprint U1 step 3a: atlas.commit_deltas and head materialisation.
  // rebuildHead and the head==fold comparison live here (not deferred to a
  // later sprint), per the amendment to keep them alongside every other
  // real-Supabase check this file already makes.
  describe('atlas.commit_deltas / head materialisation (Sprint U1 step 3a)', () => {
    let mainBranchId: string;
    let mainCommitId: string;
    const mainElementId = randomUUID();

    it('a non-member cannot call commit_deltas at all (the NULL-vs-false has_role bug this caught during development)', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main) throw new Error('main branch not found');
      mainBranchId = main.id;

      // bob is not a member of orgId at this point in the file (removed by
      // the earlier "a contributor cannot create a model" test) — this is
      // the exact scenario that caught atlas.has_role returning NULL, not
      // false, for a non-member (see the migration's own comment).
      const { error } = await bob.client.schema('atlas').rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: mainBranchId,
        p_base_commit_id: mainGenesisCommitId,
        p_kind: 'manual',
        p_title: 'non-member tries main',
        p_deltas: [],
      });
      expect(error).not.toBeNull();
    });

    it('a contributor cannot commit directly to main (ADR-015: owner/architect only, permanently)', async () => {
      const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
      if (inviteError) throw new Error(`inviting bob as contributor: ${inviteError.message}`);

      const { error } = await bob.client.schema('atlas').rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: mainBranchId,
        p_base_commit_id: mainGenesisCommitId,
        p_kind: 'manual',
        p_title: 'contributor tries main',
        p_deltas: [],
      });
      expect(error).not.toBeNull();

      const { error: removeError } = await alice.client.from('members').delete().eq('org_id', orgId).eq('user_id', bob.id);
      if (removeError) throw new Error(`removing bob: ${removeError.message}`);
    });

    it("commit_deltas rejects kind 'capture' on main (Sprint H1 item 3: only manual/merge/template_seed are allowed there)", async () => {
      const { error } = await alice.client.schema('atlas').rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: mainBranchId,
        p_base_commit_id: mainGenesisCommitId,
        p_kind: 'capture',
        p_title: 'capture kind on main',
        p_deltas: [],
      });
      expect(error).not.toBeNull();
    });

    it("commit_deltas rejects kind 'capture' and 'template_seed' on a change branch (only manual/merge are allowed there)", async () => {
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'kind-restriction-check',
        createdBy: alice.id,
        mainHeadCommitId: mainGenesisCommitId,
      });
      for (const kind of ['capture', 'template_seed']) {
        const { error } = await alice.client.schema('atlas').rpc('commit_deltas', {
          p_commit_id: randomUUID(),
          p_model_id: modelId,
          p_branch_id: branch.id,
          p_base_commit_id: mainGenesisCommitId,
          p_kind: kind,
          p_title: `${kind} kind on a change branch`,
          p_deltas: [],
        });
        expect(error).not.toBeNull();
      }
    });

    it("commit_deltas now accepts kind 'merge' on a change branch — a refresh pulling main into the branch (Sprint C1, S-11; lifts Sprint H1 item 3's restriction now that the review queue is the product path)", async () => {
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'refresh-kind-check',
        createdBy: alice.id,
        mainHeadCommitId: mainGenesisCommitId,
      });
      const { data, error } = await alice.client.schema('atlas').rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: branch.id,
        p_base_commit_id: mainGenesisCommitId,
        p_kind: 'merge',
        p_title: 'refresh: pull main into the branch',
        p_deltas: [],
        p_merged_branch_head_commit_id: mainGenesisCommitId,
      });
      expect(error).toBeNull();
      expect(data).toMatchObject({ kind: 'merge', merged_branch_head_commit_id: mainGenesisCommitId });
    });

    it('alice (owner) commits directly to main; elements_head and facts materialise for the new head', async () => {
      mainCommitId = randomUUID();
      const result = await commitToBranch(alice.client, {
        modelId,
        branchId: mainBranchId,
        expectedHeadCommitId: mainGenesisCommitId,
        envelope: {
          id: mainCommitId,
          branchId: mainBranchId,
          parentCommitId: mainGenesisCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: 'add Tenant Portal directly to main',
          body: null,
          deltas: [makeCreateDelta(randomUUID(), mainElementId, 'Tenant Portal', aliceManualSourceId)],
        },
      });
      expect(result).toMatchObject({ ok: true });

      const { data: headRows, error } = await service.from('elements_head').select('element_id, name').eq('commit_id', mainCommitId);
      if (error) throw new Error(`reading elements_head: ${error.message}`);
      // elements_head is the *whole* materialised head at this commit, not
      // just what this commit itself added — it also carries the genesis
      // seed's two capability elements (Root/Child Capability) alongside
      // the one this test just created.
      expect(headRows).toContainEqual({ element_id: mainElementId, name: 'Tenant Portal' });

      // Sprint H1 item 4 (docs/AUDIT-2026-09-U2.md §2.E.3 item 1): facts.org_id/
      // model_id are backfilled/populated columns now, not absent — every fact
      // this commit asserted should carry the model's real org_id/model_id.
      const { data: factRows, error: factsError } = await service.from('facts').select('org_id, model_id').eq('commit_id', mainCommitId).eq('subject_id', mainElementId);
      if (factsError) throw new Error(`reading facts: ${factsError.message}`);
      expect(factRows.length).toBeGreaterThan(0);
      for (const row of factRows) {
        expect(row).toMatchObject({ org_id: orgId, model_id: modelId });
      }
    });

    it('createTag refuses a commit whose materialised elements_head has been corrupted (P-7)', async () => {
      const { error: corruptError } = await service.from('elements_head').update({ name: 'Corrupted Name' }).eq('commit_id', mainCommitId).eq('element_id', mainElementId);
      if (corruptError) throw new Error(`corrupting elements_head: ${corruptError.message}`);

      await expect(createTag(alice.client, { id: randomUUID(), orgId, modelId, name: 'corrupted-attempt', commitId: mainCommitId, createdBy: alice.id })).rejects.toThrow(/does not match its delta history/);

      // Repair before any later test relies on this commit's projection
      // being correct — the same repair path SPEC §6.6 names for exactly
      // this situation, and already proven correct by the next test.
      await rebuildHead(service, modelId);
    });

    it("rebuildHead recomputes main's head independently and matches exactly, byte for byte (SPEC §6.6's head == fold(deltas))", async () => {
      // The independent half: fold from genesis ourselves, without going
      // through rebuildHead, so this isn't just checking rebuildHead
      // agrees with itself.
      const loader = await buildCommitLoader(service, modelId);
      const expectedHead = foldFromGenesis(mainCommitId, loader);
      const expected = serializeHeadProjection(expectedHead);

      const result = await rebuildHead(service, modelId);
      expect(result.commitId).toBe(mainCommitId);
      expect(result.headHash).toBe(headHash(expectedHead));
      expect(result.elementCount).toBe(expected.elementsHead.length);

      const { data: elementsHead, error: elementsError } = await service
        .from('elements_head')
        .select('element_id, element_type, name, parent_id, attributes, exists_delta_id')
        .eq('commit_id', mainCommitId);
      if (elementsError) throw new Error(`reading elements_head: ${elementsError.message}`);
      const byElementId = (rows: { element_id: string }[]) => [...rows].sort((a, b) => a.element_id.localeCompare(b.element_id));
      expect(byElementId(elementsHead)).toEqual(byElementId(expected.elementsHead));

      const { data: factsRows, error: factsError } = await service
        .from('facts')
        .select('subject_type, subject_id, attribute, value, delta_id, source_id, confidence, asserted_by')
        .eq('commit_id', mainCommitId);
      if (factsError) throw new Error(`reading facts: ${factsError.message}`);
      const byFactKey = (rows: { subject_id: string; attribute: string }[]) => [...rows].sort((a, b) => `${a.subject_id} ${a.attribute}`.localeCompare(`${b.subject_id} ${b.attribute}`));
      expect(byFactKey(factsRows)).toEqual(
        byFactKey(expected.facts.map(({ source_ref: _sourceRef, effective_date: _effectiveDate, asserted_at: _assertedAt, ...rest }) => rest)),
      );
    });

    it('rebuildHead is idempotent: running it again on an already-correct head changes nothing observable', async () => {
      const before = await rebuildHead(service, modelId);
      const after = await rebuildHead(service, modelId);
      expect(after).toEqual(before);
    });
  });

  // Sprint C1 step 2: merge_requests and the five atlas.* review-queue
  // functions (ADR-006, SPEC §7). Each `it` forks its own branch off
  // whatever main's current head happens to be at that point in the file —
  // deliberately, so these tests don't depend on running in a particular
  // order relative to the describe block above.
  describe('merge_requests / review queue workflow (Sprint C1 step 2, ADR-006, SPEC §7)', () => {
    it('submit_merge_request moves the branch to proposed and records the request; re-submitting a non-draft branch is rejected', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'submit-check',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });

      const requestId = randomUUID();
      const { data, error } = await alice.client.schema('atlas').rpc('submit_merge_request', {
        p_id: requestId,
        p_branch_id: branch.id,
        p_classification: { hasBlockingConflict: false },
      });
      expect(error).toBeNull();
      expect(data).toMatchObject({ id: requestId, branch_id: branch.id, status: 'pending' });
      expect((await getBranch(alice.client, branch.id))?.status).toBe('proposed');

      const { error: resubmitError } = await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: randomUUID(), p_branch_id: branch.id, p_classification: {} });
      expect(resubmitError).not.toBeNull();
    });

    it('approve_merge_request refuses a blocking conflict and refuses a non-owner/architect reviewer', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'approve-check',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      const requestId = randomUUID();
      await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: requestId, p_branch_id: branch.id, p_classification: { hasBlockingConflict: true } });

      const { error: blockedError } = await alice.client.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: requestId });
      expect(blockedError).not.toBeNull();

      const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
      if (inviteError) throw new Error(`inviting bob: ${inviteError.message}`);
      const { error: contributorError } = await bob.client.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: requestId });
      expect(contributorError).not.toBeNull();
      const { error: removeError } = await alice.client.from('members').delete().eq('org_id', orgId).eq('user_id', bob.id);
      if (removeError) throw new Error(`removing bob: ${removeError.message}`);
    });

    it('the full submit -> approve -> merge path: the branch becomes merged, and its element lands on main via the merge commit', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'full-merge-path',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      if (!branch.head_commit_id) throw new Error('branch has no head at creation');

      const elementId = randomUUID();
      const commitResult = await commitToBranch(alice.client, {
        modelId,
        branchId: branch.id,
        expectedHeadCommitId: branch.head_commit_id,
        envelope: {
          id: randomUUID(),
          branchId: branch.id,
          parentCommitId: branch.head_commit_id,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: 'add Resident Portal',
          body: null,
          deltas: [makeCreateDelta(randomUUID(), elementId, 'Resident Portal', aliceManualSourceId)],
        },
      });
      expect(commitResult).toMatchObject({ ok: true });
      const branchAfterCommit = await getBranch(alice.client, branch.id);
      if (!branchAfterCommit?.head_commit_id) throw new Error('branch has no head after commit');

      const requestId = randomUUID();
      const { error: submitError } = await alice.client.schema('atlas').rpc('submit_merge_request', {
        p_id: requestId,
        p_branch_id: branch.id,
        p_classification: { hasBlockingConflict: false },
      });
      expect(submitError).toBeNull();

      const { error: approveError } = await alice.client.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: requestId });
      expect(approveError).toBeNull();

      // The final merge carries zero deltas (SPEC §7.1: once mergeBase(B) ==
      // main.head, there's nothing left to resolve) — its resulting head is
      // exactly the branch's own folded head, computed the same way
      // commitToBranch already computes any main commit's projection.
      const loader = await buildCommitLoader(alice.client, modelId);
      const mergedHead = foldFromGenesis(branchAfterCommit.head_commit_id, loader);
      const projection = serializeHeadProjection(mergedHead);
      const mergeCommitId = randomUUID();

      const { data: mergeData, error: mergeError } = await alice.client.schema('atlas').rpc('merge_branch', {
        p_merge_request_id: requestId,
        p_commit_id: mergeCommitId,
        p_title: 'merge full-merge-path',
        p_elements_head: projection.elementsHead,
        p_relationships_head: projection.relationshipsHead,
        p_facts: projection.facts,
        p_head_hash: headHash(mergedHead),
      });
      expect(mergeError).toBeNull();
      expect(mergeData).toMatchObject({ id: mergeCommitId, kind: 'merge', merged_branch_head_commit_id: branchAfterCommit.head_commit_id });

      expect((await getBranch(alice.client, branch.id))?.status).toBe('merged');
      expect((await getMainBranch(alice.client, modelId))?.head_commit_id).toBe(mergeCommitId);

      const { data: headRow, error: headError } = await service.from('elements_head').select('element_id, name').eq('commit_id', mergeCommitId).eq('element_id', elementId);
      if (headError) throw new Error(`reading elements_head: ${headError.message}`);
      expect(headRow).toMatchObject([{ element_id: elementId, name: 'Resident Portal' }]);

      // rebuildHead recomputes the merge commit's head independently
      // (fold from genesis, not trusting what merge_branch's own
      // p_elements_head/p_relationships_head/p_facts payload wrote) and
      // must match it byte for byte (SPEC §6.6's head == fold(deltas)) —
      // the same check the "rebuildHead recomputes main's head
      // independently..." test below runs for a plain commit, exercised
      // here for a merge commit specifically, since a merge folds a
      // second branch's exclusive commits in (SPEC §6.2's fold
      // pseudocode) and that path deserves its own proof, not an
      // inference from the plain-commit case.
      const rebuildResult = await rebuildHead(service, modelId);
      expect(rebuildResult.commitId).toBe(mergeCommitId);
      expect(rebuildResult.headHash).toBe(headHash(mergedHead));
    });

    it('atlas.commit_deltas writes resolved_conflicts atomically alongside the resolving commit (ADR-007, SPEC §7.4)', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'resolved-conflicts-check',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      if (!branch.head_commit_id) throw new Error('branch has no head at creation');

      // Seed an element whose name-setting delta stands in as the "losing"
      // side of a field conflict a refresh is about to resolve.
      const elementId = randomUUID();
      const losingDeltaId = randomUUID();
      const seedResult = await commitToBranch(alice.client, {
        modelId,
        branchId: branch.id,
        expectedHeadCommitId: branch.head_commit_id,
        envelope: {
          id: randomUUID(),
          branchId: branch.id,
          parentCommitId: branch.head_commit_id,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: 'seed an element to conflict over',
          body: null,
          deltas: [makeCreateDelta(losingDeltaId, elementId, 'Contested System', aliceManualSourceId)],
        },
      });
      expect(seedResult).toMatchObject({ ok: true });
      const branchAfterSeed = await getBranch(alice.client, branch.id);
      if (!branchAfterSeed?.head_commit_id) throw new Error('branch has no head after seeding');

      // A refresh (kind = 'merge' on the branch, S-11) carrying one
      // resolution delta and its resolved_conflicts row, exactly as SPEC
      // §7.4's field-conflict actions describe.
      const winningDeltaId = randomUUID();
      const mergeCommitId = randomUUID();
      const { data: refreshCommit, error: refreshError } = await alice.client.schema('atlas').rpc('commit_deltas', {
        p_commit_id: mergeCommitId,
        p_model_id: modelId,
        p_branch_id: branch.id,
        p_base_commit_id: branchAfterSeed.head_commit_id,
        p_kind: 'merge',
        p_title: 'refresh: resolve a field conflict on name',
        p_deltas: [
          {
            id: winningDeltaId,
            kind: 'element_update',
            subject_id: elementId,
            element_type: 'system',
            attribute: 'name',
            value: 'Resolved Name',
            previous_delta_id: losingDeltaId,
            source_id: aliceManualSourceId,
            confidence: 1,
          },
        ],
        p_merged_branch_head_commit_id: branchAfterSeed.head_commit_id,
        // A typed-in value's winning_delta_id IS the resolution delta
        // itself (SPEC §7.4: "the chosen one or the resolution delta itself
        // for a typed-in value") — unlike "keep this change"/"keep main",
        // which would cite an existing side's delta id instead.
        p_resolved_conflicts: [{ winning_delta_id: winningDeltaId, discarded_delta_id: losingDeltaId, resolution_delta_id: winningDeltaId, rationale: "kept the branch's name over main's" }],
      });
      expect(refreshError).toBeNull();
      expect(refreshCommit).toMatchObject({ id: mergeCommitId, kind: 'merge' });

      const { data: resolvedRows, error: resolvedError } = await service
        .from('resolved_conflicts')
        .select('winning_delta_id, discarded_delta_id, resolution_delta_id, rationale')
        .eq('winning_delta_id', winningDeltaId);
      if (resolvedError) throw new Error(`reading resolved_conflicts: ${resolvedError.message}`);
      expect(resolvedRows).toMatchObject([{ winning_delta_id: winningDeltaId, discarded_delta_id: losingDeltaId, resolution_delta_id: winningDeltaId, rationale: "kept the branch's name over main's" }]);
    });

    it("a refresh after main moved sets base_commit_id to main's new head, and resolveBranchModeProjection's As-is matches main's head fold (Sprint C1-H item 2)", async () => {
      const mainBeforeFork = await getMainBranch(alice.client, modelId);
      if (!mainBeforeFork?.head_commit_id) throw new Error('main branch not found');
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'base-commit-id-refresh-check',
        createdBy: alice.id,
        mainHeadCommitId: mainBeforeFork.head_commit_id,
      });
      if (!branch.base_commit_id || !branch.head_commit_id) throw new Error('branch has no base/head at creation');
      expect(branch.base_commit_id).toBe(mainBeforeFork.head_commit_id);

      // Move main out from under the branch's fork point, exactly like the
      // REFRESH_REQUIRED test above — this is the state a refresh is
      // supposed to catch base_commit_id up to.
      const mainAdvanceResult = await commitToBranch(alice.client, {
        modelId,
        branchId: mainBeforeFork.id,
        expectedHeadCommitId: mainBeforeFork.head_commit_id,
        envelope: {
          id: randomUUID(),
          branchId: mainBeforeFork.id,
          parentCommitId: mainBeforeFork.head_commit_id,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: 'advance main past the branch fork point',
          body: null,
          deltas: [makeCreateDelta(randomUUID(), randomUUID(), 'Refreshed-In System', aliceManualSourceId)],
        },
      });
      expect(mainAdvanceResult).toMatchObject({ ok: true });
      const mainAfterAdvance = await getMainBranch(alice.client, modelId);
      if (!mainAfterAdvance?.head_commit_id) throw new Error('main branch not found after advancing');
      expect(mainAfterAdvance.head_commit_id).not.toBe(mainBeforeFork.head_commit_id);

      // The refresh itself: kind = 'merge' on the branch, pulling main's
      // new head in. Zero deltas of its own — fold() (SPEC §6.2) walks
      // mergedBranchHead's exclusive commits and applies their deltas;
      // nothing here conflicts, so there's nothing to resolve (same shape
      // as the "commit_deltas now accepts kind 'merge'" test above).
      const { data: refreshCommit, error: refreshError } = await alice.client.schema('atlas').rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: branch.id,
        p_base_commit_id: branch.head_commit_id,
        p_kind: 'merge',
        p_title: 'refresh: pull main into the branch',
        p_deltas: [],
        p_merged_branch_head_commit_id: mainAfterAdvance.head_commit_id,
      });
      expect(refreshError).toBeNull();
      expect(refreshCommit).toMatchObject({ kind: 'merge', merged_branch_head_commit_id: mainAfterAdvance.head_commit_id });

      const branchAfterRefresh = await getBranch(alice.client, branch.id);
      expect(branchAfterRefresh?.base_commit_id).toBe(mainAfterAdvance.head_commit_id);
      if (!branchAfterRefresh) throw new Error('branch not found after refresh');

      // resolveBranchModeProjection's As-is (branch.base_commit_id) must
      // now fold to exactly the same projection as main's own head —
      // fold's own determinism (P-1) means two separate fold() calls
      // against the same commit id and the same commit/delta history
      // produce byte-identical output, so a plain toEqual is a real
      // equality check, not an approximation.
      const loader = await buildCommitLoader(alice.client, modelId);
      const expectedProjection = serializeHeadProjection(foldFromGenesis(mainAfterAdvance.head_commit_id, loader));
      const asIs = await resolveBranchModeProjection(alice.client, modelId, branchAfterRefresh, 'asIs');
      expect(asIs?.commitId).toBe(mainAfterAdvance.head_commit_id);
      expect(asIs?.projection).toEqual(expectedProjection);
    });

    it("merge_branch reports REFRESH_REQUIRED — via a null return, not a thrown error, so its own reset to pending/proposed isn't rolled back — when main moved after approval", async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const branch = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'stale-approval-check',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      const requestId = randomUUID();
      await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: requestId, p_branch_id: branch.id, p_classification: { hasBlockingConflict: false } });
      const { error: approveError } = await alice.client.schema('atlas').rpc('approve_merge_request', { p_merge_request_id: requestId });
      expect(approveError).toBeNull();

      // Move main directly (as owner), out from under the already-approved
      // request, without the branch ever refreshing onto the new head.
      const mainMoveResult = await commitToBranch(alice.client, {
        modelId,
        branchId: main.id,
        expectedHeadCommitId: main.head_commit_id,
        envelope: {
          id: randomUUID(),
          branchId: main.id,
          parentCommitId: main.head_commit_id,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: 'move main out from under the approval',
          body: null,
          deltas: [makeCreateDelta(randomUUID(), randomUUID(), 'Unrelated System', aliceManualSourceId)],
        },
      });
      expect(mainMoveResult).toMatchObject({ ok: true });

      const { data: mergeData, error: mergeError } = await alice.client.schema('atlas').rpc('merge_branch', {
        p_merge_request_id: requestId,
        p_commit_id: randomUUID(),
        p_title: 'stale merge attempt',
      });
      expect(mergeError).toBeNull();
      // atlas.merge_branch's `returns commits` means PostgREST serialises
      // its own `return null;` (the stale-approval case) as a row of null
      // columns, not a bare JSON null (src/db/mergeRequests.ts's own note
      // on this) — mergeData's own id is the reliable signal either way.
      expect((mergeData as { id: string | null } | null)?.id ?? null).toBeNull();

      const { data: reqRow, error: reqError } = await service.from('merge_requests').select('status').eq('id', requestId).single();
      if (reqError) throw new Error(`reading merge_requests: ${reqError.message}`);
      expect(reqRow.status).toBe('pending');
      expect((await getBranch(alice.client, branch.id))?.status).toBe('proposed');
    });

    it('request_changes reopens a proposed branch for edits; reject_merge_request closes a request permanently', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');

      const branchA = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'request-changes-check',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      const requestA = randomUUID();
      await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: requestA, p_branch_id: branchA.id, p_classification: {} });
      const { error: rcError } = await alice.client.schema('atlas').rpc('request_changes', { p_merge_request_id: requestA, p_review_notes: 'please split the retract out' });
      expect(rcError).toBeNull();
      expect((await getBranch(alice.client, branchA.id))?.status).toBe('draft');
      const { data: reqARow, error: reqAError } = await service.from('merge_requests').select('status, review_notes').eq('id', requestA).single();
      if (reqAError) throw new Error(`reading merge_requests: ${reqAError.message}`);
      expect(reqARow).toMatchObject({ status: 'changes_requested', review_notes: 'please split the retract out' });

      const branchB = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'reject-check',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      const requestB = randomUUID();
      await alice.client.schema('atlas').rpc('submit_merge_request', { p_id: requestB, p_branch_id: branchB.id, p_classification: {} });
      const { error: rejectError } = await alice.client.schema('atlas').rpc('reject_merge_request', { p_merge_request_id: requestB, p_review_notes: 'superseded' });
      expect(rejectError).toBeNull();
      expect((await getBranch(alice.client, branchB.id))?.status).toBe('rejected');
    });
  });

  // Sprint C1 step 2: description/target_date/split_from round-trip
  // (CLAUDE.md rule 1 — migration, contract type, and round-trip test
  // together).
  describe('branches.description / target_date / split_from (Sprint C1 step 2, SPEC §3.4)', () => {
    it('createChangeBranch persists description and target_date; a split branch records split_from', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');

      const original = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'metadata-check',
        title: 'Retire the legacy CRM',
        description: 'Decommission System X and move its data flows to the new CRM.',
        targetDate: '2026-12-01',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      expect(original).toMatchObject({ description: 'Decommission System X and move its data flows to the new CRM.', target_date: '2026-12-01', split_from: null });

      await updateBranchMetadata(alice.client, original.id, { description: 'Decommission System X.', targetDate: '2027-01-15' });
      const updated = await getBranch(alice.client, original.id);
      expect(updated).toMatchObject({ description: 'Decommission System X.', target_date: '2027-01-15' });

      // split_from is schema-only at this point (ADR-006 amendment, SPEC §1
      // S-22) — the split-branch mechanic itself is Sprint C1's review-queue
      // step, not yet built — so this exercises only the column round-trip
      // via a plain insert, the way a future atlas.split_branch will write it.
      const splitId = randomUUID();
      const { error: splitError } = await alice.client
        .from('branches')
        .insert({
          id: splitId,
          org_id: orgId,
          model_id: modelId,
          name: 'metadata-check-split',
          kind: 'change',
          status: 'draft',
          base_commit_id: main.head_commit_id,
          head_commit_id: main.head_commit_id,
          split_from: original.id,
          created_by: alice.id,
        });
      if (splitError) throw new Error(`inserting split branch: ${splitError.message}`);
      expect((await getBranch(alice.client, splitId))?.split_from).toBe(original.id);
    });

    it('split_from is rejected on a non-change branch (branches_split_from_is_change)', async () => {
      const main = await getMainBranch(alice.client, modelId);
      if (!main?.head_commit_id) throw new Error('main branch not found');
      const other = await createChangeBranch(alice.client, {
        id: randomUUID(),
        orgId,
        modelId,
        name: 'split-from-target',
        createdBy: alice.id,
        mainHeadCommitId: main.head_commit_id,
      });
      const { error } = await service.from('branches').update({ split_from: other.id }).eq('id', main.id);
      expect(error).not.toBeNull();
    });
  });

  describe('capability map publishing (scripts/publishCapabilityMap.ts, immutability once published)', () => {
    it('refuses to publish with no sources, then with only a placeholder source; publishes once a real reviewer replaces it; deprecates the previous published version; and locks items against further writes', async () => {
      const draftMapId = randomUUID();
      const { error: draftMapError } = await service.from('capability_maps').insert({ id: draftMapId, sector: 'nhs', version: 999, status: 'draft', source_description: 'Publish-flow integration test fixture' });
      if (draftMapError) throw new Error(`draft map fixture: ${draftMapError.message}`);
      const itemId = randomUUID();
      const { error: itemError } = await service.from('capability_map_items').insert({ id: itemId, map_id: draftMapId, code: '1', parent_code: null, name: 'Test Capability', level: 1 });
      if (itemError) throw new Error(`item fixture: ${itemError.message}`);

      // No sources at all.
      await expect(publishCapabilityMap(service, 'nhs', 999)).rejects.toThrow(/no capability_map_sources row/);

      // A source, but still the drafting placeholder.
      const sourceId = randomUUID();
      const { error: sourceError } = await service
        .from('capability_map_sources')
        .insert({ id: sourceId, map_id: draftMapId, citation: 'Test source', reviewed_by: 'Pending human review — drafted by Claude Code', reviewed_at: '2026-01-01' });
      if (sourceError) throw new Error(`source fixture: ${sourceError.message}`);
      await expect(publishCapabilityMap(service, 'nhs', 999)).rejects.toThrow(/still the drafting placeholder/);

      // A real reviewer's name replaces the placeholder — publishing now succeeds.
      const { error: reviewError } = await service.from('capability_map_sources').update({ reviewed_by: 'A. Reviewer' }).eq('id', sourceId);
      if (reviewError) throw new Error(`review-name fixture update: ${reviewError.message}`);
      const firstPublish = await publishCapabilityMap(service, 'nhs', 999);
      expect(firstPublish.deprecated).toEqual([]);
      const { data: publishedRow } = await service.from('capability_maps').select('status, published_at').eq('id', draftMapId).maybeSingle();
      expect(publishedRow).toMatchObject({ status: 'published' });
      expect((publishedRow as { published_at: string | null } | null)?.published_at).not.toBeNull();

      // Immutable once published: insert, update and delete on its items are all rejected.
      const { error: insertAfterPublish } = await service.from('capability_map_items').insert({ id: randomUUID(), map_id: draftMapId, code: '2', parent_code: null, name: 'Too Late', level: 1 });
      expect(insertAfterPublish?.message).toMatch(/published and immutable/);
      const { error: updateAfterPublish } = await service.from('capability_map_items').update({ name: 'Renamed' }).eq('id', itemId);
      expect(updateAfterPublish?.message).toMatch(/published and immutable/);
      const { error: deleteAfterPublish } = await service.from('capability_map_items').delete().eq('id', itemId);
      expect(deleteAfterPublish?.message).toMatch(/published and immutable/);

      // A second, later version of the same sector supersedes the first: publishing it deprecates v999.
      const secondMapId = randomUUID();
      const { error: secondMapError } = await service.from('capability_maps').insert({ id: secondMapId, sector: 'nhs', version: 1000, status: 'draft', source_description: 'Publish-flow integration test fixture, v2' });
      if (secondMapError) throw new Error(`second draft map fixture: ${secondMapError.message}`);
      const { error: secondSourceError } = await service
        .from('capability_map_sources')
        .insert({ id: randomUUID(), map_id: secondMapId, citation: 'Test source v2', reviewed_by: 'A. Reviewer', reviewed_at: '2026-01-02' });
      if (secondSourceError) throw new Error(`second source fixture: ${secondSourceError.message}`);
      const secondPublish = await publishCapabilityMap(service, 'nhs', 1000);
      expect(secondPublish.deprecated).toEqual([999]);
      const { data: firstMapAfter } = await service.from('capability_maps').select('status').eq('id', draftMapId).maybeSingle();
      expect(firstMapAfter).toMatchObject({ status: 'deprecated' });
    });
  });
});
