/**
 * F2 (narrowed capture pipeline), Phase 1 — the whole import flow against
 * a real local Supabase: parse → match → build deltas → create a
 * `record`-intent change branch → commit. Exercises the same db functions
 * `useSpreadsheetImport.ts` calls, directly (no React), so this is real
 * proof the RLS/RPC path actually works, not just that the pure logic
 * (`matchImportRows.test.ts`/`buildImportCommit.test.ts`) is internally
 * consistent.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope, Delta } from '../contracts/delta';
import type { FactsRow } from '../contracts/rows';
import { createChangeBranch, getMainBranch } from '../db/branches';
import { listCapabilitiesForMap } from '../db/capabilityMap';
import { loadProjectionAtCommit } from '../db/branchProjection';
import type { Client } from '../db/client';
import { createServiceRoleClient, createSupabaseClient } from '../db/client';
import { commitToBranch } from '../db/commits';
import { loadEnv } from '../db/env';
import { listFactsForCommit } from '../db/healthFindings';
import { listSystemsForLandscape } from '../db/landscape';
import { createModel } from '../db/models';
import { createOrganisation } from '../db/organisations';
import { createSpreadsheetSource, getOrCreateManualSource } from '../db/sources';
import { buildImportDeltas } from './buildImportCommit';
import { validateImportRow } from './importRowSchema';
import { matchImportRows } from './matchImportRows';

const env = loadEnv();
const service = createServiceRoleClient(env);

async function createSignedInUser(label: string): Promise<{ id: string; client: Client }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client: signIn };
}

describe('spreadsheet import (F2 Phase 1) against a real local Supabase', () => {
  let owner: { id: string; client: Client };
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('import-owner');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Import Test Org', slug: `import-org-${orgId.slice(0, 8)}`, createdBy: owner.id });
    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Import Test Model', slug: `import-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('lands a new system, an update to an existing one, and a supports link on a fresh record-intent change branch', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch was not auto-created');

    // Seed one existing system and one capability directly (deep-link
    // style, the same `commitToBranch` seeding pattern this repo's own
    // engine specs already use) — the import below both updates the
    // system and links a new one to the capability.
    const existingSystemId = randomUUID();
    const capabilityId = randomUUID();
    const seedSource = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    const seedDeltas: Delta[] = [
      { kind: 'element.create', id: randomUUID(), elementId: existingSystemId, elementType: 'system', name: 'Council Tax System', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: seedSource.id, confidence: 1 },
      { kind: 'element.create', id: randomUUID(), elementId: capabilityId, elementType: 'capability', name: 'Billing', parentId: null, attributes: {}, sourceId: seedSource.id, confidence: 1 },
    ];
    const seedEnvelope: CommitEnvelope = { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'seed one system and one capability', body: null, deltas: seedDeltas };
    const seedResult = await commitToBranch(owner.client, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope: seedEnvelope });
    if (!seedResult.ok) throw new Error(`seeding: ${seedResult.message}`);

    const mainAfterSeed = await getMainBranch(owner.client, modelId);
    if (!mainAfterSeed) throw new Error('main disappeared after seeding');

    // The "file" — one row updating the existing system's description and
    // one row for a brand-new system, linked to the seeded capability.
    const parsedRows = [validateImportRow({ name: 'Council Tax System', description: 'Handles council tax accounts.' }, 2), validateImportRow({ name: 'Northgate', description: "The borough's new revenues platform.", supports: 'Billing' }, 3)];
    const rows = parsedRows.flatMap((r) => (r.ok ? [r.row] : []));
    expect(rows).toHaveLength(2);

    const [systems, capabilities] = await Promise.all([listSystemsForLandscape(owner.client, mainAfterSeed.head_commit_id), listCapabilitiesForMap(owner.client, mainAfterSeed.head_commit_id)]);
    const matchedRows = matchImportRows(rows, systems, capabilities);

    const allFacts = await listFactsForCommit(owner.client, mainAfterSeed.head_commit_id);
    const factsByElementId = new Map<string, Map<string, FactsRow>>();
    for (const fact of allFacts) {
      if (fact.subject_type !== 'element') continue;
      const forElement = factsByElementId.get(fact.subject_id) ?? new Map<string, FactsRow>();
      forElement.set(fact.attribute, fact);
      factsByElementId.set(fact.subject_id, forElement);
    }
    const existsDeltaIdByElementId = new Map(systems.map((s) => [s.element_id, s.exists_delta_id]));

    const source = await createSpreadsheetSource(owner.client, { id: randomUUID(), orgId, modelId, createdBy: owner.id, fileName: 'systems.csv' });
    const { deltas, warnings } = buildImportDeltas({ matchedRows, resolutions: new Map(), sourceId: source.id, factsByElementId, existsDeltaIdByElementId });
    expect(warnings).toEqual([]);
    // One update (Council Tax System's description) + one create (Northgate) + one supports create.
    expect(deltas).toHaveLength(3);

    const branch = await createChangeBranch(owner.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `import-test-${randomUUID().slice(0, 8)}`,
      title: 'Import: systems.csv',
      createdBy: owner.id,
      mainHeadCommitId: mainAfterSeed.head_commit_id,
      intent: 'record',
    });
    expect(branch.intent).toBe('record');

    const envelope: CommitEnvelope = { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'Import 1 system(s) from "systems.csv"', body: null, deltas };
    const result = await commitToBranch(owner.client, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A change branch's own head is never materialised into
    // `elements_head`/`relationships_head`/`facts` (SPEC §1 S-2/P-6 —
    // those tables exist for main/tags only, "at any point in its life",
    // per `useElementPage.ts`'s own doc comment on this exact gap) — its
    // current state is read by folding in memory instead, the same way
    // every other branch-aware page in this app already does.
    const projection = await loadProjectionAtCommit(owner.client, modelId, result.commitId);
    const names = projection.elementsHead
      .filter((e) => e.element_type === 'system')
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(['Council Tax System', 'Northgate']);

    const councilTaxDescription = projection.facts.find((f) => f.subject_id === existingSystemId && f.attribute === 'description');
    expect(councilTaxDescription?.value).toBe('Handles council tax accounts.');

    const supportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports');
    expect(supportsEdges.map((r) => r.to_element_id)).toEqual([capabilityId]);
  });
});
