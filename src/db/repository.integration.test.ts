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
import { createChangeBranch, getBranch, getMainBranch, listBranchesForModel } from './branches';
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
import { createTag, listTagsForModel } from './tags';
import { getUserPreferences, upsertUserPreferences } from './userPreferences';

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

function makeCreateDelta(id: string, elementId: string, name: string): Delta {
  return { kind: 'element.create', id, elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: 'manual', confidence: 1 };
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

    // A minimal published capability map, inserted as service_role —
    // standing in for scripts/loadCapabilityMaps.ts, which is the one that
    // really writes these tables (RLS grants authenticated select only).
    // Two levels, so the genesis seed below actually exercises parent
    // linking, not just a single root.
    capabilityMapId = randomUUID();
    const rootItemId = randomUUID();
    const childItemId = randomUUID();
    const { error: mapError } = await service
      .from('capability_maps')
      .insert({ id: capabilityMapId, sector: 'generic', version: 1, status: 'published', source_description: 'Integration test fixture', published_at: new Date().toISOString() });
    if (mapError) throw new Error(`capability_maps fixture: ${mapError.message}`);
    const { error: itemsError } = await service.from('capability_map_items').insert([
      { id: rootItemId, map_id: capabilityMapId, code: '1', parent_code: null, name: 'Root Capability', level: 1 },
      { id: childItemId, map_id: capabilityMapId, code: '1.1', parent_code: '1', name: 'Child Capability', level: 2 },
    ]);
    if (itemsError) throw new Error(`capability_map_items fixture: ${itemsError.message}`);

    // Main's genesis commit through the real tailoring-flow "import" path
    // (Sprint U2 step 2), replacing the former service-role stand-in insert
    // this beforeAll used before atlas.seed_from_map existed.
    const main = await getMainBranch(alice.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');
    const items = await listCapabilityMapItems(alice.client, capabilityMapId);
    const seedResult = await seedModelFromCapabilityMap(alice.client, {
      modelId,
      branchId: main.id,
      authorId: alice.id,
      capabilityMapId,
      sector: 'generic',
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
        authorId: alice.id,
        capabilityMapId,
        sector: 'generic',
        version: 1,
        items,
      });
      expect(result.ok).toBe(false);
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
        message: 'add Housing Options',
        authorId: alice.id,
        deltas: [makeCreateDelta(randomUUID(), elementId, 'Housing Options')],
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
      message: name,
      authorId: alice.id,
      deltas: [makeCreateDelta(randomUUID(), randomUUID(), name)],
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
      const { error } = await bob.client.rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: mainBranchId,
        p_base_commit_id: mainGenesisCommitId,
        p_kind: 'manual',
        p_message: 'non-member tries main',
        p_deltas: [],
      });
      expect(error).not.toBeNull();
    });

    it('a contributor cannot commit directly to main (ADR-015: owner/architect only, permanently)', async () => {
      const { error: inviteError } = await alice.client.from('members').insert({ org_id: orgId, user_id: bob.id, role: 'contributor', invited_by: alice.id });
      if (inviteError) throw new Error(`inviting bob as contributor: ${inviteError.message}`);

      const { error } = await bob.client.rpc('commit_deltas', {
        p_commit_id: randomUUID(),
        p_model_id: modelId,
        p_branch_id: mainBranchId,
        p_base_commit_id: mainGenesisCommitId,
        p_kind: 'manual',
        p_message: 'contributor tries main',
        p_deltas: [],
      });
      expect(error).not.toBeNull();

      const { error: removeError } = await alice.client.from('members').delete().eq('org_id', orgId).eq('user_id', bob.id);
      if (removeError) throw new Error(`removing bob: ${removeError.message}`);
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
          message: 'add Tenant Portal directly to main',
          authorId: alice.id,
          deltas: [makeCreateDelta(randomUUID(), mainElementId, 'Tenant Portal')],
        },
      });
      expect(result).toMatchObject({ ok: true });

      const { data: headRows, error } = await service.from('elements_head').select('element_id, name').eq('commit_id', mainCommitId);
      if (error) throw new Error(`reading elements_head: ${error.message}`);
      expect(headRows).toMatchObject([{ element_id: mainElementId, name: 'Tenant Portal' }]);
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
});
