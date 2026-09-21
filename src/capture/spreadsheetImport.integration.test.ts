/**
 * F2-lite ("spreadsheet import as reconciliation") — the whole import flow
 * against a real local Supabase: parse -> match -> build deltas -> create a
 * `record`-intent change branch -> commit -> submit/approve/merge.
 * Exercises the same db functions `useSpreadsheetImport.ts`/`ChangeView.tsx`
 * call, directly (no React), so this is real proof the RLS/RPC path works,
 * not just that the pure logic (`matchImportRows.test.ts`/
 * `buildImportCommit.test.ts`) is internally consistent.
 *
 * The scenario: import a ten-row fixture, merge it, then import a second
 * ten-row file that edits two rows, adds one new row, spells one existing
 * row's name as a near-match, and simply omits one row entirely. Proves,
 * end to end: exact-name reconciliation against a real head, the near-match
 * pick writing a real alias, "not in file" reading back
 * `sources.import_touched_element_ids` (round-tripping the column
 * `20260918010000_import_touched_element_ids.sql` added), and the second
 * change merging cleanly.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommitEnvelope } from '../contracts/delta';
import type { FactsRow } from '../contracts/rows';
import { computeNotInFile } from './notInFile';
import { listAliasesForModel } from '../db/aliases';
import { cancelChange, createChangeBranch, getBranch, getMainBranch } from '../db/branches';
import { listCapabilitiesForMap } from '../db/capabilityMap';
import type { Client } from '../db/client';
import { createServiceRoleClient, createSupabaseClient } from '../db/client';
import { commitToBranch } from '../db/commits';
import { loadEnv } from '../db/env';
import { listAllUsesAndFlowsToEdges, listFactsForCommit } from '../db/healthFindings';
import { listActorsForLandscape, listContainersForLandscape, listSystemsForLandscape } from '../db/landscape';
import { approveMergeRequest, computeMergeReviewForBranch, mergeApprovedRequest, submitMergeRequest } from '../db/mergeRequests';
import { createModel } from '../db/models';
import { createOrganisation } from '../db/organisations';
import { createSpreadsheetSource, listSourcesForModel } from '../db/sources';
import { buildImportDeltas, type MatchResolution } from './buildImportCommit';
import { validateImportRow } from './importRowSchema';
import { matchImportRows } from './matchImportRows';
import { parseImportJson } from './parseImportJson';

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

describe('spreadsheet import (F2-lite, reconciliation) against a real local Supabase', () => {
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

  /** One full load -> match -> build -> commit run, mirroring `useSpreadsheetImport.ts` exactly (this test has no React tree to run the hook itself in). */
  async function runImport(fileName: string, csvRows: Record<string, unknown>[], resolutions: Map<number, MatchResolution>) {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch not found');

    const rows = csvRows.map((raw, i) => validateImportRow(raw, i + 2)).flatMap((r) => (r.ok ? [r.row] : []));
    expect(rows).toHaveLength(csvRows.length);

    const [systems, containers, capabilities, actors, aliasesByElementId, allFacts] = await Promise.all([
      listSystemsForLandscape(owner.client, main.head_commit_id),
      listContainersForLandscape(owner.client, main.head_commit_id),
      listCapabilitiesForMap(owner.client, main.head_commit_id),
      listActorsForLandscape(owner.client, main.head_commit_id),
      listAliasesForModel(owner.client, modelId),
      listFactsForCommit(owner.client, main.head_commit_id),
    ]);
    const matchedRows = matchImportRows({ rows, systems, containers, capabilities, actors, aliasesByElementId });

    const factsByElementId = new Map<string, Map<string, FactsRow>>();
    for (const fact of allFacts) {
      if (fact.subject_type !== 'element') continue;
      const forElement = factsByElementId.get(fact.subject_id) ?? new Map<string, FactsRow>();
      forElement.set(fact.attribute, fact);
      factsByElementId.set(fact.subject_id, forElement);
    }
    const existsDeltaIdByElementId = new Map([...systems, ...containers].map((e) => [e.element_id, e.exists_delta_id]));

    const final = buildImportDeltas({ matchedRows, resolutions, fileName, sourceId: 'placeholder', factsByElementId, existsDeltaIdByElementId });
    expect(final.rows.some((r) => r.outcome.status === 'needs-pick' || r.outcome.status === 'blocked')).toBe(false);

    // Import close-out: a confirmed same-as pick's alias is staged as
    // `pending_aliases`, never written immediately — `submitApproveAndMerge`
    // below is what actually applies it, via `mergeApprovedRequest`.
    const source = await createSpreadsheetSource(owner.client, { id: randomUUID(), orgId, modelId, createdBy: owner.id, fileName, touchedElementIds: final.touchedElementIds, pendingAliases: final.aliasesToWrite });
    // `sourceId` is purely a provenance tag on each delta (never branched on
    // inside buildImportDeltas) — patch it in place rather than calling
    // buildImportDeltas a second time. A second call would mint a fresh
    // random element id for every 'new' row all over again, producing a
    // *different* set of element ids than the ones already written to
    // source.touchedElementIds above.
    const rebuilt = { ...final, deltas: final.deltas.map((d) => ({ ...d, sourceId: source.id })) };

    const branch = await createChangeBranch(owner.client, { id: randomUUID(), orgId, modelId, name: `import-${fileName.replace(/\.[^./]+$/, '')}-${randomUUID().slice(0, 8)}`, title: `Imported from ${fileName}`, createdBy: owner.id, mainHeadCommitId: main.head_commit_id, intent: 'record' });
    const envelope: CommitEnvelope = { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: `Import from ${fileName}`, body: null, deltas: rebuilt.deltas };
    const commitResult = await commitToBranch(owner.client, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
    if (!commitResult.ok) throw new Error(`commit: ${commitResult.message}`);

    return { source, branch, final: rebuilt, systems, containers };
  }

  /**
   * F2-lite JSON import's own end-to-end run — the same load -> match ->
   * build -> commit shape `runImport` above exercises, but starting from a
   * real `.json` file parsed by `parseImportJson` (not `validateImportRow`
   * called directly), so this is real proof the JSON reader itself, not just
   * `buildImportDeltas`'s own handling of `relationshipRows`/`changeRows`,
   * works against a real head.
   */
  async function runJsonImport(fileName: string, jsonBody: unknown, resolutions: Map<number, MatchResolution>) {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch not found');

    const file = new File([JSON.stringify(jsonBody)], fileName, { type: 'application/json' });
    const parsed = await parseImportJson(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.relationshipErrors).toEqual([]);
    expect(parsed.changeErrors).toEqual([]);

    const [systems, containers, capabilities, actors, aliasesByElementId, allFacts, usesFlowsToEdges] = await Promise.all([
      listSystemsForLandscape(owner.client, main.head_commit_id),
      listContainersForLandscape(owner.client, main.head_commit_id),
      listCapabilitiesForMap(owner.client, main.head_commit_id),
      listActorsForLandscape(owner.client, main.head_commit_id),
      listAliasesForModel(owner.client, modelId),
      listFactsForCommit(owner.client, main.head_commit_id),
      listAllUsesAndFlowsToEdges(owner.client, main.head_commit_id),
    ]);
    const matchedRows = matchImportRows({ rows: parsed.rows, systems, containers, capabilities, actors, aliasesByElementId });

    const factsByElementId = new Map<string, Map<string, FactsRow>>();
    const relationshipFactsByRelationshipId = new Map<string, Map<string, FactsRow>>();
    for (const fact of allFacts) {
      if (fact.subject_type === 'element') {
        const forElement = factsByElementId.get(fact.subject_id) ?? new Map<string, FactsRow>();
        forElement.set(fact.attribute, fact);
        factsByElementId.set(fact.subject_id, forElement);
      } else {
        const forRelationship = relationshipFactsByRelationshipId.get(fact.subject_id) ?? new Map<string, FactsRow>();
        forRelationship.set(fact.attribute, fact);
        relationshipFactsByRelationshipId.set(fact.subject_id, forRelationship);
      }
    }
    const existsDeltaIdByElementId = new Map([...systems, ...containers].map((e) => [e.element_id, e.exists_delta_id]));

    const buildInput = { matchedRows, resolutions, fileName, factsByElementId, existsDeltaIdByElementId, relationshipRows: parsed.relationshipRows, systems, containers, actors, aliasesByElementId, currentUsesFlowsToEdges: usesFlowsToEdges, relationshipFactsByRelationshipId, changeRows: parsed.changeRows };
    const final = buildImportDeltas({ ...buildInput, sourceId: 'placeholder' });
    expect(final.rows.some((r) => r.outcome.status === 'needs-pick' || r.outcome.status === 'blocked')).toBe(false);
    expect(final.relationshipRows.some((r) => r.outcome.status === 'blocked')).toBe(false);
    expect(final.changeRows.some((r) => r.outcome.status === 'blocked')).toBe(false);

    const source = await createSpreadsheetSource(owner.client, { id: randomUUID(), orgId, modelId, createdBy: owner.id, fileName, touchedElementIds: final.touchedElementIds, pendingAliases: final.aliasesToWrite });
    // Same fix as runImport above: patch sourceId in place instead of a
    // second buildImportDeltas call, which would mint different element ids
    // than the ones already written to source.touchedElementIds.
    const rebuilt = { ...final, deltas: final.deltas.map((d) => ({ ...d, sourceId: source.id })) };

    const branch = await createChangeBranch(owner.client, { id: randomUUID(), orgId, modelId, name: `import-${fileName.replace(/\.[^./]+$/, '')}-${randomUUID().slice(0, 8)}`, title: `Imported from ${fileName}`, createdBy: owner.id, mainHeadCommitId: main.head_commit_id, intent: 'record' });
    const envelope: CommitEnvelope = { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: `Import from ${fileName}`, body: null, deltas: rebuilt.deltas };
    const commitResult = await commitToBranch(owner.client, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
    if (!commitResult.ok) throw new Error(`commit: ${commitResult.message}`);

    return { branch, final: rebuilt };
  }

  /** `record`-intent's own one-click review path (`useApproveAndMerge.ts`'s own doc comment) — submit with no assigned reviewers, then approve+merge as the same owner. */
  async function submitApproveAndMerge(branchId: string): Promise<void> {
    const branch = await getBranch(owner.client, branchId);
    if (!branch) throw new Error('branch not found');
    const computed = await computeMergeReviewForBranch(owner.client, modelId, branch);
    if (!computed) throw new Error('could not compute merge review');
    const request = await submitMergeRequest(owner.client, randomUUID(), branchId, computed.review, null);
    const approved = await approveMergeRequest(owner.client, request.id);
    const branchAfterApproval = await getBranch(owner.client, branchId);
    if (!branchAfterApproval) throw new Error('branch not found after approval');
    const mergeResult = await mergeApprovedRequest(owner.client, modelId, approved.id, branchAfterApproval, `Merge: ${branch.title ?? branch.name}`);
    if (!mergeResult.ok) throw new Error(`merge: ${mergeResult.message}`);
  }

  // Ten genuinely distinct names — verified (a throwaway scratch check, not
  // kept) to score below the 0.6 fuzzy threshold against every other one of
  // the ten, so exact rows below never risk a spurious fuzzy neighbour; only
  // the two names deliberately built to collide (`NEAR_MATCH_NAME` against
  // "Council Tax System", `NEW_ROW_NAME` against none of the ten) exercise
  // the fuzzy tier at all.
  const TEN_NAMES = ['Northgate', 'Riverside Payments', 'Council Tax System', 'Housing Register', 'Electoral Roll', 'Waste Collection', 'Parking Permits', 'Library Catalogue', 'Planning Portal', 'Benefits Claims'];
  const NEAR_MATCH_NAME = 'Council Tax Systym';
  const NEW_ROW_NAME = 'Environmental Health';

  it('imports ten new systems, then a second file that edits two, adds one, near-matches one by a typo’d name, and omits one entirely', async () => {
    // --- Run 1: ten brand-new systems, merged into main. ---
    const firstFileRows = TEN_NAMES.map((name) => ({ name, description: `Description of ${name}` }));
    const first = await runImport('systems-1.csv', firstFileRows, new Map());
    expect(first.final.rows.every((r) => r.outcome.status === 'new')).toBe(true);
    expect(first.final.deltas.filter((d) => d.kind === 'element.create')).toHaveLength(10);

    // Round-trip: `sources.import_touched_element_ids` reads back exactly what was written (CLAUDE.md rule 1's own round-trip requirement for the migration `20260918010000_import_touched_element_ids.sql` added).
    const sourcesAfterFirst = await listSourcesForModel(owner.client, modelId);
    const firstSourceRow = sourcesAfterFirst.find((s) => s.id === first.source.id);
    expect(new Set(firstSourceRow?.import_touched_element_ids ?? [])).toEqual(new Set(first.final.touchedElementIds));

    await submitApproveAndMerge(first.branch.id);
    const mainAfterFirst = await getMainBranch(owner.client, modelId);
    if (!mainAfterFirst) throw new Error('main not found after first merge');
    const systemsAfterFirst = await listSystemsForLandscape(owner.client, mainAfterFirst.head_commit_id);
    expect(systemsAfterFirst.map((s) => s.name).sort()).toEqual(firstFileRows.map((r) => r.name).sort());
    const idByName = new Map(systemsAfterFirst.map((s) => [s.name, s.element_id]));

    // --- Run 2: two edits (Housing Register, Electoral Roll), one new (Environmental Health), one near-match (Council Tax Systym -> Council Tax System), Benefits Claims entirely absent. ---
    const secondFileRows = [
      { name: 'Northgate', description: 'Description of Northgate' },
      { name: 'Riverside Payments', description: 'Description of Riverside Payments' },
      { name: 'Housing Register', description: 'Updated description of Housing Register' },
      { name: 'Electoral Roll', description: 'Updated description of Electoral Roll' },
      { name: 'Waste Collection', description: 'Description of Waste Collection' },
      { name: 'Parking Permits', description: 'Description of Parking Permits' },
      { name: 'Library Catalogue', description: 'Description of Library Catalogue' },
      { name: 'Planning Portal', description: 'Description of Planning Portal' },
      { name: NEAR_MATCH_NAME, description: 'Description of Council Tax System' },
      { name: NEW_ROW_NAME, description: 'Description of Environmental Health' },
    ];
    // Row 9 (1-based `rowNumber` 10, +2 offset) is the near-match — resolve it to Council Tax System's own element id, the same-as pick a reviewer would make in the dialog.
    const nearMatchRowNumber = 10;
    const resolutions = new Map<number, MatchResolution>([[nearMatchRowNumber, idByName.get('Council Tax System') ?? '']]);
    const second = await runImport('systems-2.csv', secondFileRows, resolutions);

    expect(second.final.deltas.filter((d) => d.kind === 'element.update')).toHaveLength(2);
    expect(second.final.deltas.filter((d) => d.kind === 'element.create')).toHaveLength(1);
    expect(second.final.rows.filter((r) => r.outcome.status === 'changed').map((r) => r.name).sort()).toEqual(['Electoral Roll', 'Housing Register']);
    expect(second.final.rows.filter((r) => r.outcome.status === 'new').map((r) => r.name)).toEqual([NEW_ROW_NAME]);
    // Council Tax System's own row: no attribute actually differs once resolved (both say "Description of Council Tax System"), so it's unchanged — the pick still counts as touched, and still earns an alias below.
    expect(second.final.rows.find((r) => r.name === NEAR_MATCH_NAME)?.outcome).toEqual({ status: 'unchanged', elementId: idByName.get('Council Tax System') });
    expect(second.final.aliasesToWrite).toEqual([{ elementId: idByName.get('Council Tax System'), aliasValue: NEAR_MATCH_NAME }]);

    // "Not in file": Benefits Claims, the one row this run's own file never mentions at all.
    const notInFile = computeNotInFile(second.systems, second.containers, new Set(second.final.touchedElementIds));
    expect(notInFile.map((e) => e.name)).toEqual(['Benefits Claims']);

    await submitApproveAndMerge(second.branch.id);

    // The alias is real and durable — a later lookup by the file's own misspelling resolves to Council Tax System.
    const aliasesByElementId = await listAliasesForModel(owner.client, modelId);
    expect(aliasesByElementId.get(idByName.get('Council Tax System') ?? '')).toEqual([NEAR_MATCH_NAME]);

    const mainAfterSecond = await getMainBranch(owner.client, modelId);
    if (!mainAfterSecond) throw new Error('main not found after second merge');
    const systemsAfterSecond = await listSystemsForLandscape(owner.client, mainAfterSecond.head_commit_id);
    expect(systemsAfterSecond.map((s) => s.name).sort()).toEqual([...firstFileRows.map((r) => r.name), NEW_ROW_NAME].sort());
    const updatedHousingRegister = await listFactsForCommit(owner.client, mainAfterSecond.head_commit_id).then((facts) => facts.find((f) => f.subject_id === idByName.get('Housing Register') && f.attribute === 'description'));
    expect(updatedHousingRegister?.value).toBe('Updated description of Housing Register');
  });

  it('a confirmed same-as pick’s alias round-trips as sources.pending_aliases, stays unwritten on commit, and is never written at all if the change is cancelled', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch not found');
    const systems = await listSystemsForLandscape(owner.client, main.head_commit_id);
    const wasteCollectionId = systems.find((s) => s.name === 'Waste Collection')?.element_id;
    if (!wasteCollectionId) throw new Error('Waste Collection not found — expected from the earlier test in this file');

    const nearMatchRows = [{ name: 'Waste Collectionn', description: 'Description of Waste Collection' }];
    const resolutions = new Map<number, MatchResolution>([[2, wasteCollectionId]]);
    const { source, branch, final } = await runImport('pending-alias.csv', nearMatchRows, resolutions);
    expect(final.aliasesToWrite).toEqual([{ elementId: wasteCollectionId, aliasValue: 'Waste Collectionn' }]);

    // Round-trip: the pending alias was written to sources.pending_aliases, not to a real aliases row.
    const sourcesNow = await listSourcesForModel(owner.client, modelId);
    const sourceRow = sourcesNow.find((s) => s.id === source.id);
    expect(sourceRow?.pending_aliases).toEqual([{ elementId: wasteCollectionId, aliasValue: 'Waste Collectionn' }]);
    const aliasesRightAfterCommit = await listAliasesForModel(owner.client, modelId);
    expect(aliasesRightAfterCommit.get(wasteCollectionId) ?? []).not.toContain('Waste Collectionn');

    // Cancelling the change leaves the pending alias forever unwritten.
    await cancelChange(owner.client, branch.id, 'testing: cancel leaves no alias');
    const aliasesAfterCancel = await listAliasesForModel(owner.client, modelId);
    expect(aliasesAfterCancel.get(wasteCollectionId) ?? []).not.toContain('Waste Collectionn');
  });

  it('F2-lite JSON import: {systems, relationships, changes} reuses the same reconciliation end to end', async () => {
    const main = await getMainBranch(owner.client, modelId);
    if (!main) throw new Error('main branch not found');
    const systems = await listSystemsForLandscape(owner.client, main.head_commit_id);
    const parkingPermitsId = systems.find((s) => s.name === 'Parking Permits')?.element_id;
    if (!parkingPermitsId) throw new Error('Parking Permits not found — expected from the earlier test in this file');

    const jsonBody = {
      systems: [{ name: 'Northgate', description: 'Description of Northgate' }],
      relationships: [{ from: 'Northgate', type: 'uses', to: 'Riverside Payments', description: 'reads payment status from' }],
      changes: [{ name: 'Parking Permits', action: 'retire', reason: 'Service ended' }],
    };
    const { branch, final } = await runJsonImport('import.json', jsonBody, new Map());
    expect(final.rows).toEqual([{ rowNumber: 1, name: 'Northgate', outcome: { status: 'unchanged', elementId: expect.any(String) }, warnings: [] }]);
    expect(final.relationshipRows).toEqual([{ rowNumber: 1, outcome: { status: 'new' } }]);
    expect(final.changeRows).toEqual([{ rowNumber: 1, name: 'Parking Permits', action: 'retire', reason: 'Service ended', outcome: { status: 'applied', elementId: parkingPermitsId } }]);

    await submitApproveAndMerge(branch.id);

    const mainAfterMerge = await getMainBranch(owner.client, modelId);
    if (!mainAfterMerge) throw new Error('main not found after merge');
    const factsAfterMerge = await listFactsForCommit(owner.client, mainAfterMerge.head_commit_id);
    expect(factsAfterMerge.find((f) => f.subject_id === parkingPermitsId && f.attribute === 'lifecycleStatus')?.value).toBe('retired');

    const edgesAfterMerge = await listAllUsesAndFlowsToEdges(owner.client, mainAfterMerge.head_commit_id);
    const systemsAfterMerge = await listSystemsForLandscape(owner.client, mainAfterMerge.head_commit_id);
    const northgateId = systemsAfterMerge.find((s) => s.name === 'Northgate')?.element_id;
    const riversidePaymentsId = systemsAfterMerge.find((s) => s.name === 'Riverside Payments')?.element_id;
    expect(edgesAfterMerge.some((e) => e.relationship_type === 'uses' && e.from_element_id === northgateId && e.to_element_id === riversidePaymentsId)).toBe(true);
  });
});
