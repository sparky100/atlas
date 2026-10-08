/**
 * The export → import round trip, demonstrated end to end against a real
 * local Supabase (2026-10-08). Model A is seeded the way a real one is —
 * through `commitToBranch` — then:
 *
 *   1. exported with the app's own loaders and builders (`loadExportData`,
 *      `buildExportSheets`) and written as the `.xlsx` the Export button
 *      downloads;
 *   2. imported into a brand-new, empty model B through the real capture
 *      path: `runCapture` → `atlas.write_capture_draft` →
 *      `atlas.stage_capture_decisions` → `atlas.apply_capture_decisions`
 *      onto a change branch, every gate and RLS policy included;
 *   3. B's change branch compared with A's main, element by element and
 *      relationship by relationship, by name.
 *
 * and, separately, A's own export imported back into A — which must find
 * nothing new to create. The importer is given no model: every header the
 * export writes is a recognised synonym, so prompt A is never asked (it
 * throws if it is), and nothing here stands in for one.
 *
 * The comparison covers every element (type, name, parent), the attributes
 * the export carries and the importer reads (`COMPARED_ATTRIBUTES`) and every
 * relationship with its role or verb; it is exact, so a duplicate or a
 * missing row fails it.
 */
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCandidateRowToWire, captureCandidateWireToRow, type CaptureCandidate, type CaptureCandidateRowShape } from '../contracts/capture';
import type { Delta, UUID } from '../contracts/delta';
import { envelopeToDeltaRows } from '../contracts/rows';
import { createChangeBranch, getMainBranch } from '../db/branches';
import type { Client } from '../db/client';
import { createServiceRoleClient, createSupabaseClient } from '../db/client';
import { buildCommitLoader } from '../db/commitLoader';
import { commitToBranch } from '../db/commits';
import { listAllElements, loadOwnersByElementId, type BrowseRow } from '../db/elementBrowse';
import { loadEnv } from '../db/env';
import { createModel } from '../db/models';
import { createOrganisation } from '../db/organisations';
import { getOrCreateManualSource } from '../db/sources';
import type { Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildExportSheets } from '../ui/elements/elementExport';
import { loadExportData } from '../ui/elements/loadExportData';
import { buildCaptureDraftEnvelope } from './buildCaptureDraftEnvelope';
import { buildPromotionEnvelope } from './buildPromotionEnvelope';
import { loadCaptureDraftHead } from './loadCaptureDraftHead';
import { loadTargetBranchHead } from './loadTargetBranchHead';
import { buildMatchIndex } from './matchIndex';
import { runCapture, type ResolvedCandidate } from './runCapture';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
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
  return { id: created.user.id, client: signIn };
}

// ---------------------------------------------------------------------------
// Model A — a small model with the shapes that broke a real export: two
// platforms each with a module called "PM", a capability tree three levels
// deep, similarly named capabilities and systems, an owner, and every
// relationship type the Relationships sheet carries.
// ---------------------------------------------------------------------------

const ids = {
  salesforce: randomUUID(),
  sap: randomUUID(),
  arcgis: randomUUID(),
  aurora: randomUUID(),
  cbrm: randomUUID(),
  cbrmLegacy: randomUUID(),
  escoms: randomUUID(),
  pmSap: randomUUID(),
  pmSalesforce: randomUUID(),
  enterprise: randomUUID(),
  customer: randomUUID(),
  quotations: randomUUID(),
  connections: randomUUID(),
  pricing: randomUUID(),
  land: randomUUID(),
  networkOps: randomUUID(),
  planned: randomUUID(),
  assetInspection: randomUUID(),
  team: randomUUID(),
};

function seedDeltas(sourceId: UUID): Delta[] {
  const system = (elementId: UUID, name: string, attributes: Record<string, unknown> = {}): Delta =>
    ({ kind: 'element.create', id: randomUUID(), elementId, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false, ...attributes }, sourceId, confidence: 1 });
  const module = (elementId: UUID, name: string, parentId: UUID, attributes: Record<string, unknown> = {}): Delta =>
    ({ kind: 'element.create', id: randomUUID(), elementId, elementType: 'container', name, parentId, attributes: { isExternal: false, ...attributes }, sourceId, confidence: 1 });
  const capability = (elementId: UUID, name: string, parentId: UUID | null, description?: string, extra: Record<string, unknown> = {}): Delta =>
    ({ kind: 'element.create', id: randomUUID(), elementId, elementType: 'capability', name, parentId, attributes: { ...(description ? { description } : {}), ...extra }, sourceId, confidence: 1 });
  const edge = (relationshipType: string, from: UUID, to: UUID, attributes: Record<string, unknown>): Delta =>
    ({ kind: 'relationship.create', id: randomUUID(), relationshipId: randomUUID(), relationshipType, fromElementId: from, toElementId: to, attributes, sourceId, confidence: 1 }) as Delta;
  return [
    system(ids.salesforce, 'Salesforce', { kind: 'platform', vendor: 'Salesforce Inc', hostingModel: 'saas', criticality: 'high', domain: 'it', introduced: '2019-04-01' }),
    system(ids.sap, 'SAP', { kind: 'platform', vendor: 'SAP SE', hostingModel: 'private_cloud', criticality: 'high', plannedEnd: '2031-12-31', version: '4.2', annualRunCost: '1m_5m', supportEndsAt: '2030-06-30' }),
    system(ids.arcgis, 'ArcGIS', { kind: 'platform', vendor: 'ESRI' }),
    system(ids.aurora, 'Aurora', { lifecycleStatus: 'retiring', vendor: 'Acme', isExternal: true, externalOrganisation: 'Acme Ltd', disposition: 'eliminate', domain: 'ot' }),
    system(ids.cbrm, 'CBRM', { description: 'Condition based risk management' }),
    system(ids.cbrmLegacy, 'CBRM (legacy)', { lifecycleStatus: 'retiring' }),
    module(ids.escoms, 'ESCOMS', ids.salesforce, { description: 'Wayleave and consent management', technology: 'Apex', criticality: 'medium' }),
    module(ids.pmSap, 'PM', ids.sap, { description: 'Plant maintenance' }),
    module(ids.pmSalesforce, 'PM', ids.salesforce, { description: 'Programme management' }),
    module(ids.enterprise, 'Enterprise', ids.arcgis),
    capability(ids.customer, 'Customer', null),
    capability(ids.quotations, 'Connection Quotations', ids.customer),
    capability(ids.connections, 'Connections', ids.customer, 'Connecting new customers to the network.'),
    capability(ids.pricing, 'Quotation Pricing', ids.quotations),
    capability(ids.land, 'Land, Wayleaves & Consents', null, undefined, { code: 'LAND-1', importance: 'high', essentialFunction: true }),
    capability(ids.networkOps, 'Network Operations', null),
    capability(ids.planned, 'Planned Maintenance & Inspection', ids.networkOps),
    capability(ids.assetInspection, 'Asset Inspection & Maintenance', ids.networkOps),
    { kind: 'element.create', id: randomUUID(), elementId: ids.team, elementType: 'actor', name: 'Network Team', parentId: null, attributes: { subtype: 'team', isExternal: false, email: 'network.team@example.org', orgUnit: 'Networks' }, sourceId, confidence: 1 },
    edge('supports', ids.escoms, ids.land, { role: 'primary' }),
    edge('supports', ids.aurora, ids.connections, { role: 'secondary' }),
    edge('supports', ids.pmSap, ids.planned, { role: 'primary' }),
    edge('supports', ids.cbrm, ids.assetInspection, { role: 'primary' }),
    edge('supports', ids.enterprise, ids.quotations, { role: 'secondary' }),
    edge('uses', ids.escoms, ids.enterprise, { description: 'looks up land parcels in' }),
    edge('flows_to', ids.pmSalesforce, ids.aurora, { description: 'sends programme tasks to' }),
    edge('flows_to', ids.pmSap, ids.cbrm, { description: 'sends asset condition to' }),
    edge('owns', ids.team, ids.aurora, { role: 'business' }),
  ];
}

// ---------------------------------------------------------------------------
// The export — exactly what the Export XLSX button does.
// ---------------------------------------------------------------------------

async function exportAsXlsx(client: Client, modelId: UUID): Promise<ArrayBuffer> {
  const main = await getMainBranch(client, modelId);
  if (!main?.head_commit_id) throw new Error('model has no head');
  const elements = await listAllElements(client, main.head_commit_id);
  const owners = await loadOwnersByElementId(client, main.head_commit_id, new Map(elements.map((e) => [e.element_id, e])));
  const rows: BrowseRow[] = [...elements]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((element) => ({ element, owner: owners.get(element.element_id) ?? null, lifecycleStatus: null, criticality: null, disposition: null, parent: null }));
  const data = await loadExportData(client, modelId, main.head_commit_id);
  const sheets = buildExportSheets(rows, [], data.provenanceById, data.relationships, data.nameById);
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.cells), sheet.name);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// The import — runCapture, then the real draft/stage/apply RPCs.
// ---------------------------------------------------------------------------

/** Importing this product's own export needs no model: every header it writes is in the synonym table, so prompt A is never asked — and nothing here supplies one. */
const llm = {
  complete: (): Promise<never> => {
    throw new Error("the importer asked the model for help reading its own export — a header the export writes isn't in the synonym table");
  },
};

async function matchIndexFor(client: Client, modelId: UUID) {
  const main = await getMainBranch(client, modelId);
  const elements = main?.head_commit_id ? await listAllElements(client, main.head_commit_id) : [];
  const { data, error } = await client.from('aliases').select('element_id, alias_value, alias_type').eq('model_id', modelId);
  if (error) throw new Error(`aliases: ${error.message}`);
  return buildMatchIndex(elements, data);
}

async function runImport(user: TestUser, modelId: UUID, bytes: ArrayBuffer) {
  const main = await getMainBranch(user.client, modelId);
  if (!main) throw new Error('main missing');
  const loader = await buildCommitLoader(user.client, modelId);
  const mainHead = main.head_commit_id ? foldFromGenesis(main.head_commit_id, loader) : (await import('../engine/deltas')).emptyHead();
  const result = await runCapture({
    inputName: 'export.xlsx',
    source: { format: 'xlsx', bytes },
    documentDate: '2026-10-08',
    llmClient: llm,
    matchIndex: await matchIndexFor(user.client, modelId),
    mainHead,
    mintId: randomUUID,
  });
  if (result.status !== 'parsed') throw new Error(`the export did not parse: ${JSON.stringify(result)}`);
  return { result, main, mainHead };
}

/** Writes the draft and promotes every candidate that can be, onto a new change branch — the review's "accept all" — and returns that branch's folded head. */
async function applyAll(user: TestUser, orgId: UUID, modelId: UUID, imported: Awaited<ReturnType<typeof runImport>>): Promise<{ head: Head; candidates: CaptureCandidate[] }> {
  const { result, main, mainHead } = imported;
  const jobId = randomUUID();
  const { error: jobError } = await user.client.from('capture_jobs').insert({
    id: jobId,
    org_id: orgId,
    model_id: modelId,
    input_kind: 'spreadsheet',
    input_name: 'export.xlsx',
    input_ref: `capture-inputs/${orgId}/${modelId}/${jobId}/export.xlsx`,
    input_sha256: '\\x' + '00'.repeat(32),
    document_date: '2026-10-08',
    created_by: user.id,
  });
  if (jobError) throw new Error(`capture job: ${jobError.message}`);

  const candidates: CaptureCandidate[] = result.candidates.map((resolved: ResolvedCandidate) => ({
    id: randomUUID(),
    orgId,
    jobId,
    modelId,
    seq: resolved.seq,
    kind: resolved.kind,
    class: resolved.class,
    elementType: resolved.elementType,
    relationshipType: resolved.relationshipType,
    draftSubjectId: resolved.draftSubjectId,
    proposal: resolved.proposal,
    evidence: resolved.evidence,
    match: resolved.match,
    confidence: resolved.confidence,
    rowKey: resolved.rowKey,
    reimportStatus: resolved.reimportStatus,
    draftDeltaIds: [],
    aliasProposals: resolved.aliasProposals,
    decision: resolved.class === 'confirm' ? 'accepted' : null,
    decisionDetail: null,
    decidedBy: null,
    decidedAt: null,
    promotedCommitId: null,
    promotedSubjectId: null,
    createdAt: new Date().toISOString(),
  }));

  const draftBranchId = randomUUID();
  const draftCommitId = randomUUID();
  const draftSource = await getOrCreateManualSource(user.client, { id: randomUUID(), orgId, modelId, userId: user.id });
  const { envelope, draftDeltaIdsBySeq } = buildCaptureDraftEnvelope({ commitId: draftCommitId, branchId: draftBranchId, parentCommitId: main.head_commit_id, title: 'Capture from export.xlsx', body: null, sourceId: draftSource.id, effectiveDate: '2026-10-08', mainHead, candidates, mintId: randomUUID });
  const { error: draftError } = await service.schema('atlas').rpc('write_capture_draft', {
    p_job_id: jobId,
    p_branch_id: draftBranchId,
    p_commit_id: draftCommitId,
    p_commit_body: envelope.body,
    p_deltas: envelopeToDeltaRows(envelope, { orgId: '', modelId: '', createdBy: '' }),
    p_candidates: candidates.map((c) => captureCandidateWireToRow({ ...c, draftDeltaIds: draftDeltaIdsBySeq.get(c.seq) ?? [] })),
    p_stats: result.stats,
  } satisfies Record<string, unknown>);
  if (draftError) throw new Error(`write_capture_draft: ${draftError.message}`);

  const { data: rows, error: readError } = await user.client.from('capture_candidates').select('*').eq('job_id', jobId).order('seq');
  if (readError) throw new Error(readError.message);
  const stored = (rows as unknown as CaptureCandidateRowShape[]).map(captureCandidateRowToWire);
  const promotable = stored.filter((c) => c.class !== 'invalid' && c.class !== 'unsourced');
  const { error: stageError } = await user.client.schema('atlas').rpc('stage_capture_decisions', {
    p_job_id: jobId,
    p_decisions: promotable.map((c) => ({ candidate_id: c.id, decision: 'accepted', decision_detail: null })),
  } satisfies Record<string, unknown>);
  if (stageError) throw new Error(`stage_capture_decisions: ${stageError.message}`);

  const targetBranchId = randomUUID();
  await createChangeBranch(user.client, { id: targetBranchId, orgId, modelId, name: `import-${randomUUID().slice(0, 8)}`, createdBy: user.id, intent: 'record', mainHeadCommitId: main.head_commit_id });
  const draftHead = await loadCaptureDraftHead(user.client, modelId, draftBranchId);
  const { head: targetHead, headCommitId: targetHeadCommitId } = await loadTargetBranchHead(user.client, modelId, targetBranchId);
  const reviewerSource = await getOrCreateManualSource(user.client, { id: randomUUID(), orgId, modelId, userId: user.id });
  const promotion = buildPromotionEnvelope({ candidates: promotable.map((c) => ({ ...c, decision: 'accepted' as const })), draftHead, targetHead, reviewerSourceId: reviewerSource.id, mintId: randomUUID });
  const applyCommitId = randomUUID();
  const { error: applyError } = await user.client.schema('atlas').rpc('apply_capture_decisions', {
    p_job_id: jobId,
    p_target_branch_id: targetBranchId,
    p_commit_id: applyCommitId,
    p_commit_title: 'Import export.xlsx',
    p_commit_body: null,
    p_deltas: envelopeToDeltaRows({ id: applyCommitId, branchId: targetBranchId, parentCommitId: targetHeadCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: 'Import export.xlsx', body: null, deltas: promotion.deltas }, { orgId: '', modelId: '', createdBy: '' }),
    p_alias_rows: promotion.aliasRows.map((a) => ({ id: a.id, element_id: a.elementId, alias_value: a.aliasValue, alias_type: a.aliasType, source_id: a.sourceId, confidence: a.confidence })),
    p_candidate_outcomes: promotable.map((c) => ({ candidate_id: c.id, promoted_subject_id: promotion.promotedSubjectIdBySeq.get(c.seq) })),
    p_resolved_conflicts: promotion.resolvedConflicts.map((r) => ({ id: r.id, winning_delta_id: r.winningDeltaId, discarded_delta_id: r.discardedDeltaId, resolution_delta_id: null, rationale: r.rationale })),
    p_stats: { decided: { accepted: promotable.length, rejected: 0, merged: 0, edited: 0, split: 0 } },
  } satisfies Record<string, unknown>);
  if (applyError) throw new Error(`apply_capture_decisions: ${applyError.message}`);

  const loaded = await loadTargetBranchHead(user.client, modelId, targetBranchId);
  return { head: loaded.head, candidates: stored };
}

// ---------------------------------------------------------------------------
// The comparison — by name, so two models with different ids compare.
// ---------------------------------------------------------------------------

/** Attributes the Elements export carries *and* the importer reads. */
const COMPARED_ATTRIBUTES = ['lifecycleStatus', 'vendor', 'description', 'isExternal', 'externalOrganisation', 'hostingModel', 'introduced', 'plannedEnd', 'technology', 'disposition', 'subtype', 'kind', 'criticality', 'domain', 'version', 'annualRunCost', 'supportEndsAt', 'code', 'importance', 'essentialFunction', 'email', 'orgUnit'] as const;

function describeModel(head: Head): { elements: string[]; attributes: string[]; relationships: string[] } {
  const key = (id: UUID): string => {
    const el = head.elements.get(id);
    if (!el) return `?${id}`;
    const parent = el.parentId !== null ? head.elements.get(el.parentId)?.name : undefined;
    return `${el.elementType}:${parent ? `${parent} / ` : ''}${el.name}`;
  };
  const elements: string[] = [];
  const attributes: string[] = [];
  for (const [id, el] of head.elements) {
    elements.push(key(id));
    for (const attribute of COMPARED_ATTRIBUTES) {
      const value = (el.attributes as Record<string, unknown>)[attribute];
      if (value !== undefined && value !== '') attributes.push(`${key(id)} ${attribute}=${JSON.stringify(value)}`);
    }
  }
  const relationships = [...head.relationships.values()].map((r) => {
    const attrs = r.attributes as Record<string, unknown>;
    const detail = typeof attrs.role === 'string' ? attrs.role : typeof attrs.description === 'string' ? attrs.description : '';
    return `${r.relationshipType} ${key(r.fromElementId)} -> ${key(r.toElementId)} [${detail}]`;
  });
  return { elements: elements.sort(), attributes: attributes.sort(), relationships: relationships.sort() };
}

describe('export → import round trip against a real local Supabase', () => {
  let owner: TestUser;
  let orgId: UUID;
  let modelA: UUID;
  let modelB: UUID;
  let workbook: ArrayBuffer;
  let modelOfA: ReturnType<typeof describeModel>;

  beforeAll(async () => {
    owner = await createSignedInUser('roundtrip-owner');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Round Trip Org', slug: `roundtrip-${orgId.slice(0, 8)}`, createdBy: owner.id });
    modelA = randomUUID();
    modelB = randomUUID();
    await createModel(owner.client, { id: modelA, orgId, name: 'Round Trip A', slug: `roundtrip-a-${modelA.slice(0, 8)}`, createdBy: owner.id });
    await createModel(owner.client, { id: modelB, orgId, name: 'Round Trip B', slug: `roundtrip-b-${modelB.slice(0, 8)}`, createdBy: owner.id });

    const main = await getMainBranch(owner.client, modelA);
    if (!main) throw new Error('main missing');
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId: modelA, userId: owner.id });
    const seeded = await commitToBranch(owner.client, {
      modelId: modelA,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: { id: randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'Seed model A', body: null, deltas: seedDeltas(source.id) },
    });
    if (!seeded.ok) throw new Error(`seed model A: ${seeded.reason} ${seeded.message}`);

    const after = await getMainBranch(owner.client, modelA);
    if (!after?.head_commit_id) throw new Error('model A has no head');
    modelOfA = describeModel(foldFromGenesis(after.head_commit_id, await buildCommitLoader(owner.client, modelA)));
    workbook = await exportAsXlsx(owner.client, modelA);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it("imports A's export into an empty model and rebuilds A's structure — every element, parent and relationship", async () => {
    const imported = await runImport(owner, modelB, workbook);
    const { head } = await applyAll(owner, orgId, modelB, imported);
    const modelOfB = describeModel(head);

    // Exact, sorted lists — so a duplicate or a missing row shows, not just a difference of sets.
    expect(modelOfB.elements).toEqual(modelOfA.elements);
    expect(modelOfB.attributes).toEqual(modelOfA.attributes);
    expect(modelOfB.relationships).toEqual(modelOfA.relationships);
  });

  it("imports A's own export back into A and finds nothing new to create", async () => {
    const { result } = await runImport(owner, modelA, workbook);
    const byClass: Record<string, number> = {};
    for (const c of result.candidates) byClass[`${c.kind}/${c.class}`] = (byClass[`${c.kind}/${c.class}`] ?? 0) + 1;
    expect(byClass['element/new'] ?? 0).toBe(0);
    expect(byClass['relationship/new'] ?? 0).toBe(0);
    expect(byClass['element/invalid'] ?? 0).toBe(0);
    expect(byClass['relationship/invalid'] ?? 0).toBe(0);
    const conflicts = result.candidates.filter((c) => c.class === 'conflict').map((c) => ({ name: c.proposal.kind === 'element' ? c.proposal.name : '', attributes: c.proposal.attributes }));
    expect(conflicts).toEqual([]);
  });
});
