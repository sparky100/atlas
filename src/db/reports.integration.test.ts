/**
 * ADR-027 (saved reports, saved copies, dashboards), F14 step 3, against a
 * real local Supabase with real RLS: who sees and edits what, the
 * organisation-sharing rules, main-only insert-only copies that survive
 * their report being edited and deleted, dashboard tiles, and
 * `atlas.delete_model` clearing the four new tables.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseReportSpec, REPORT_SPEC_VERSION, type ReportSpec } from '../contracts/reportSpec';
import { runReport } from '../engine/reportQuery';
import { createChangeBranch, getMainBranch } from './branches';
import { commitToBranch } from './commits';
import { getOrCreateManualSource } from './sources';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { archiveModel, createModel, deleteModel } from './models';
import { createOrganisation } from './organisations';
import {
  addDashboardTile,
  createDashboard,
  createReportSnapshot,
  createSavedReport,
  deleteReportSnapshot,
  deleteSavedReport,
  getReportSnapshot,
  getSavedReport,
  listDashboardTiles,
  listDashboards,
  listSavedReports,
  listSnapshotsForModel,
  listSnapshotsForReport,
  removeDashboardTile,
  reportResultOfSnapshot,
  savedReportSpec,
  updateDashboard,
  updateDashboardTile,
  updateSavedReport,
} from './reports';
import type { BranchRow } from './types';

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

const SPEC: ReportSpec = {
  specVersion: REPORT_SPEC_VERSION,
  source: 'elements',
  filters: [{ field: 'lifecycle', operator: 'eq', value: 'active' }],
  columns: ['name', 'lifecycle'],
  sort: [{ field: 'name', direction: 'asc' }],
  presentation: { kind: 'table' },
};

const ROWS = [
  { id: 'a', name: 'Billing', lifecycle: 'active' },
  { id: 'b', name: 'CRM', lifecycle: 'retiring' },
  { id: 'c', name: 'Asset register', lifecycle: 'active' },
];

describe('saved reports, saved copies and dashboards (ADR-027) against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let otherContributor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let modelId: string;
  let mainBranch: BranchRow;
  let changeBranch: BranchRow;
  /** A real commit that exists in this model but sits on the change branch, not on main. */
  let changeOnlyCommitId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('reports-owner');
    architect = await createSignedInUser('reports-architect');
    contributor = await createSignedInUser('reports-contributor');
    otherContributor = await createSignedInUser('reports-contributor2');
    viewer = await createSignedInUser('reports-viewer');
    outsider = await createSignedInUser('reports-outsider');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Reports Test Org', slug: `reports-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: otherContributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Reports Test Model', slug: `reports-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch missing');
    mainBranch = main;
    changeBranch = await createChangeBranch(owner.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: `reports-change-${randomUUID().slice(0, 8)}`,
      createdBy: owner.id,
      intent: 'propose',
      mainHeadCommitId: main.head_commit_id,
    });
    // A new change branch's head is still main's head commit, so on its own it
    // proves nothing about "a commit that is not on the branch". Put one real
    // commit on the change branch so there is a commit that is in this model
    // but not on main.
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    changeOnlyCommitId = randomUUID();
    const committed = await commitToBranch(owner.client, {
      modelId,
      branchId: changeBranch.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: changeOnlyCommitId,
        branchId: changeBranch.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'a commit only on the change branch',
        body: null,
        deltas: [{ kind: 'element.create', id: randomUUID(), elementId: randomUUID(), elementType: 'system', name: 'Change-only system', parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId: source.id, confidence: 1 }],
      },
    });
    if (!committed.ok) throw new Error(`commit on change branch: ${committed.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  function newReport(by: TestUser, overrides: { visibility?: 'private' | 'organisation'; name?: string } = {}) {
    return createSavedReport(by.client, {
      id: randomUUID(),
      orgId,
      modelId,
      name: overrides.name ?? `Report ${randomUUID().slice(0, 8)}`,
      spec: SPEC,
      ...(overrides.visibility === undefined ? {} : { visibility: overrides.visibility }),
      createdBy: by.id,
    });
  }

  function snapshotInput(by: TestUser, reportId: string | null, overrides: Partial<Parameters<typeof createReportSnapshot>[1]> = {}) {
    return {
      id: randomUUID(),
      orgId,
      modelId,
      reportId,
      name: 'Copy',
      spec: SPEC,
      branchId: mainBranch.id,
      commitId: mainBranch.head_commit_id,
      result: runReport(ROWS, SPEC),
      generatedBy: by.id,
      ...overrides,
    };
  }

  describe('saved reports', () => {
    it('a contributor creates a private report; only they see it; a viewer cannot create; an outsider sees nothing', async () => {
      const report = await newReport(contributor);
      expect(report.visibility).toBe('private');
      expect(parseReportSpec(report.spec)).toEqual({ ok: true, spec: SPEC });
      expect(await getSavedReport(contributor.client, report.id)).not.toBeNull();
      expect(await getSavedReport(otherContributor.client, report.id)).toBeNull();
      expect(await getSavedReport(architect.client, report.id)).toBeNull();
      expect(await getSavedReport(outsider.client, report.id)).toBeNull();
      await expect(newReport(viewer)).rejects.toThrow();
    });

    it('a contributor cannot share; an architect can; everyone in the org then sees it and a viewer can read but not edit', async () => {
      await expect(newReport(contributor, { visibility: 'organisation' })).rejects.toThrow(/owner or architect/);
      const shared = await newReport(architect, { visibility: 'organisation' });
      for (const member of [owner, architect, contributor, otherContributor, viewer]) {
        expect(await getSavedReport(member.client, shared.id)).not.toBeNull();
      }
      expect(await getSavedReport(outsider.client, shared.id)).toBeNull();
      await expect(updateSavedReport(viewer.client, shared.id, { name: 'hijack' })).rejects.toThrow();
      await expect(updateSavedReport(otherContributor.client, shared.id, { name: 'hijack' })).rejects.toThrow();
      const listed = await listSavedReports(viewer.client, modelId);
      expect(listed.some((r) => r.id === shared.id)).toBe(true);
    });

    it("its creator can't publish their own; an architect cannot edit someone else's private report", async () => {
      const mine = await newReport(contributor);
      await expect(updateSavedReport(contributor.client, mine.id, { visibility: 'organisation' })).rejects.toThrow(/owner or architect/);
      await expect(updateSavedReport(architect.client, mine.id, { name: 'not yours' })).rejects.toThrow();
    });

    it('editing keeps the definition valid and moves updated_at; a stored definition reads back through parseReportSpec', async () => {
      const report = await newReport(contributor);
      const edited: ReportSpec = { ...SPEC, columns: ['name'], presentation: { kind: 'table', limit: 5 } };
      await updateSavedReport(contributor.client, report.id, { name: 'Renamed', spec: edited });
      const after = await getSavedReport(contributor.client, report.id);
      expect(after?.name).toBe('Renamed');
      expect(after && new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(report.updated_at).getTime());
      expect(after && savedReportSpec(after)).toEqual({ ok: true, spec: edited });
    });

    it('refuses a definition whose version disagrees with spec_version', async () => {
      const { error } = await contributor.client.from('saved_reports').insert({
        id: randomUUID(),
        org_id: orgId,
        model_id: modelId,
        name: 'bad',
        spec: { specVersion: 1 },
        spec_version: 2,
        created_by: contributor.id,
      });
      expect(error).not.toBeNull();
    });
  });

  describe('saved copies', () => {
    it('keeps the result, the definition and the main commit it was read at, and reads back only stored data', async () => {
      const report = await newReport(contributor);
      const input = snapshotInput(contributor, report.id);
      const copy = await createReportSnapshot(contributor.client, input);
      expect(copy.branch_id).toBe(mainBranch.id);
      expect(copy.commit_id).toBe(mainBranch.head_commit_id);
      expect(reportResultOfSnapshot(copy)).toEqual(JSON.parse(JSON.stringify(input.result)));
      expect(reportResultOfSnapshot(copy).rows).toEqual([['Asset register', 'active'], ['Billing', 'active']]);
    });

    it('refuses a copy from a change branch, a commit that is not on the branch, and a result over the cap', async () => {
      await expect(createReportSnapshot(contributor.client, snapshotInput(contributor, null, { branchId: changeBranch.id, commitId: changeBranch.head_commit_id }))).rejects.toThrow(/main model/);
      await expect(createReportSnapshot(contributor.client, snapshotInput(contributor, null, { commitId: changeOnlyCommitId }))).rejects.toThrow(/not on this branch/);
      const huge = runReport(Array.from({ length: 5001 }, (_, i) => ({ id: `r${String(i)}`, name: 'x', lifecycle: 'active' })), { ...SPEC, filters: [] });
      await expect(createReportSnapshot(contributor.client, snapshotInput(contributor, null, { result: huge }))).rejects.toThrow();
    });

    it("another member cannot copy someone's private report, and a contributor cannot share a copy of a private one", async () => {
      const report = await newReport(contributor);
      await expect(createReportSnapshot(otherContributor.client, snapshotInput(otherContributor, report.id))).rejects.toThrow(/no such report/);
      await expect(createReportSnapshot(contributor.client, snapshotInput(contributor, report.id, { visibility: 'organisation' }))).rejects.toThrow(/its report is/);
    });

    it('a contributor may share a copy of a shared report; the whole org then sees it, an outsider does not; a private copy is the creator\'s alone', async () => {
      const shared = await newReport(architect, { visibility: 'organisation' });
      const sharedCopy = await createReportSnapshot(otherContributor.client, snapshotInput(otherContributor, shared.id, { visibility: 'organisation' }));
      const privateCopy = await createReportSnapshot(otherContributor.client, snapshotInput(otherContributor, shared.id));
      expect(await getReportSnapshot(viewer.client, sharedCopy.id)).not.toBeNull();
      expect(await getReportSnapshot(outsider.client, sharedCopy.id)).toBeNull();
      expect(await getReportSnapshot(contributor.client, privateCopy.id)).toBeNull();
      expect(await getReportSnapshot(otherContributor.client, privateCopy.id)).not.toBeNull();
      expect((await listSnapshotsForReport(viewer.client, shared.id)).map((c) => c.id)).toContain(sharedCopy.id);
    });

    it('can never be updated, by anyone, including through the service role', async () => {
      const copy = await createReportSnapshot(contributor.client, snapshotInput(contributor, null));
      const byCreator = await contributor.client.from('report_snapshots').update({ name: 'edited' }).eq('id', copy.id).select('id');
      expect(byCreator.error !== null || byCreator.data.length === 0).toBe(true);
      const byService = await service.from('report_snapshots').update({ rows: [] }).eq('id', copy.id);
      expect(byService.error?.message).toMatch(/cannot be changed/);
      const after = await getReportSnapshot(contributor.client, copy.id);
      expect(after?.name).toBe('Copy');
      expect(after?.rows).toEqual(copy.rows);
    });

    it('is unchanged when its report is edited, and survives the report being deleted', async () => {
      const report = await newReport(contributor);
      const copy = await createReportSnapshot(contributor.client, snapshotInput(contributor, report.id, { name: 'As reported' }));
      await updateSavedReport(contributor.client, report.id, { name: 'Different now', spec: { ...SPEC, filters: [] } });
      const afterEdit = await getReportSnapshot(contributor.client, copy.id);
      expect(afterEdit?.spec).toEqual(JSON.parse(JSON.stringify(SPEC)));
      expect(afterEdit?.rows).toEqual(copy.rows);
      expect(afterEdit?.name).toBe('As reported');

      await deleteSavedReport(contributor.client, report.id);
      const afterDelete = await getReportSnapshot(contributor.client, copy.id);
      expect(afterDelete?.report_id).toBeNull();
      expect(afterDelete?.rows).toEqual(copy.rows);
      expect((await listSnapshotsForModel(contributor.client, modelId)).some((c) => c.id === copy.id)).toBe(true);
    });

    it('can be deleted by its creator but not by another member or a viewer; an architect can delete a shared copy', async () => {
      const mine = await createReportSnapshot(contributor.client, snapshotInput(contributor, null));
      await expect(deleteReportSnapshot(otherContributor.client, mine.id)).rejects.toThrow();
      await expect(deleteReportSnapshot(viewer.client, mine.id)).rejects.toThrow();
      await deleteReportSnapshot(contributor.client, mine.id);
      expect(await getReportSnapshot(contributor.client, mine.id)).toBeNull();

      const shared = await newReport(architect, { visibility: 'organisation' });
      const sharedCopy = await createReportSnapshot(contributor.client, snapshotInput(contributor, shared.id, { visibility: 'organisation' }));
      await expect(deleteReportSnapshot(otherContributor.client, sharedCopy.id)).rejects.toThrow();
      await deleteReportSnapshot(architect.client, sharedCopy.id);
      expect(await getReportSnapshot(architect.client, sharedCopy.id)).toBeNull();
    });
  });

  describe('dashboards', () => {
    it('a creator builds a private dashboard; nobody else sees it or its tiles or can add to it', async () => {
      const report = await newReport(contributor);
      const dashboard = await createDashboard(contributor.client, { id: randomUUID(), orgId, modelId, name: 'Mine', createdBy: contributor.id });
      const tile = await addDashboardTile(contributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 0, kind: 'kpi' });
      expect(await listDashboardTiles(contributor.client, dashboard.id)).toHaveLength(1);
      expect((await listDashboards(otherContributor.client, modelId)).some((d) => d.id === dashboard.id)).toBe(false);
      expect(await listDashboardTiles(otherContributor.client, dashboard.id)).toEqual([]);
      await expect(addDashboardTile(otherContributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 1, kind: 'kpi' })).rejects.toThrow();
      await updateDashboardTile(contributor.client, tile.id, { size: 'two', kind: 'table', rowLimit: 10 });
      expect((await listDashboardTiles(contributor.client, dashboard.id))[0]).toMatchObject({ size: 'two', kind: 'table', row_limit: 10 });
      await removeDashboardTile(contributor.client, tile.id);
      expect(await listDashboardTiles(contributor.client, dashboard.id)).toEqual([]);
    });

    it('round-trips a quadrant tile, and still refuses a tile kind it does not know', async () => {
      const report = await newReport(contributor);
      const dashboard = await createDashboard(contributor.client, { id: randomUUID(), orgId, modelId, name: 'Quadrant dashboard', createdBy: contributor.id });
      const tile = await addDashboardTile(contributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 0, kind: 'quadrant' });
      expect(tile.kind).toBe('quadrant');
      const tiles = await listDashboardTiles(contributor.client, dashboard.id);
      expect(tiles.map((t) => t.kind)).toEqual(['quadrant']);
      await expect(addDashboardTile(contributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 1, kind: 'bubble' as never })).rejects.toThrow();
    });

    it('refuses two tiles at one position', async () => {
      const report = await newReport(contributor);
      const dashboard = await createDashboard(contributor.client, { id: randomUUID(), orgId, modelId, name: 'Dup', createdBy: contributor.id });
      await addDashboardTile(contributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 0, kind: 'kpi' });
      await expect(addDashboardTile(contributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 0, kind: 'kpi' })).rejects.toThrow(/position/);
    });

    it('only an architect shares a dashboard, and a shared one can only show shared reports', async () => {
      const privateReport = await newReport(architect);
      const sharedReport = await newReport(architect, { visibility: 'organisation' });
      const mine = await createDashboard(contributor.client, { id: randomUUID(), orgId, modelId, name: 'Not shareable by me', createdBy: contributor.id });
      await expect(updateDashboard(contributor.client, mine.id, { visibility: 'organisation' })).rejects.toThrow(/owner or architect/);

      const shared = await createDashboard(architect.client, { id: randomUUID(), orgId, modelId, name: 'Org view', visibility: 'organisation', createdBy: architect.id });
      await expect(addDashboardTile(architect.client, { id: randomUUID(), dashboardId: shared.id, reportId: privateReport.id, position: 0, kind: 'kpi' })).rejects.toThrow(/shared with the organisation/);
      await addDashboardTile(architect.client, { id: randomUUID(), dashboardId: shared.id, reportId: sharedReport.id, position: 0, kind: 'bar' });
      expect(await listDashboardTiles(viewer.client, shared.id)).toHaveLength(1);
      await expect(updateSavedReport(architect.client, sharedReport.id, { visibility: 'private' })).rejects.toThrow(/remove it from there first/);
    });

    it("deleting a report removes its tiles but not the dashboard", async () => {
      const report = await newReport(contributor);
      const dashboard = await createDashboard(contributor.client, { id: randomUUID(), orgId, modelId, name: 'Loses a tile', createdBy: contributor.id });
      await addDashboardTile(contributor.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 0, kind: 'kpi' });
      await deleteSavedReport(contributor.client, report.id);
      expect(await listDashboardTiles(contributor.client, dashboard.id)).toEqual([]);
      expect((await listDashboards(contributor.client, modelId)).some((d) => d.id === dashboard.id)).toBe(true);
    });
  });

  describe('deleting the model', () => {
    it('atlas.delete_model clears saved reports, copies, dashboards and tiles', async () => {
      const doomedModelId = randomUUID();
      await createModel(owner.client, { id: doomedModelId, orgId, name: 'Doomed', slug: `doomed-${doomedModelId.slice(0, 8)}`, createdBy: owner.id });
      const doomedMain = await getMainBranch(owner.client, doomedModelId);
      if (!doomedMain?.head_commit_id) throw new Error('main branch missing');
      const report = await createSavedReport(owner.client, { id: randomUUID(), orgId, modelId: doomedModelId, name: 'R', spec: SPEC, createdBy: owner.id });
      await createReportSnapshot(owner.client, {
        id: randomUUID(),
        orgId,
        modelId: doomedModelId,
        reportId: report.id,
        name: 'Copy',
        spec: SPEC,
        branchId: doomedMain.id,
        commitId: doomedMain.head_commit_id,
        result: runReport(ROWS, SPEC),
        generatedBy: owner.id,
      });
      const dashboard = await createDashboard(owner.client, { id: randomUUID(), orgId, modelId: doomedModelId, name: 'D', createdBy: owner.id });
      await addDashboardTile(owner.client, { id: randomUUID(), dashboardId: dashboard.id, reportId: report.id, position: 0, kind: 'kpi' });

      await archiveModel(owner.client, doomedModelId);
      await deleteModel(owner.client, doomedModelId);

      for (const table of ['saved_reports', 'report_snapshots', 'dashboards'] as const) {
        const { count, error } = await service.from(table).select('id', { count: 'exact', head: true }).eq('model_id', doomedModelId);
        expect(error).toBeNull();
        expect(count).toBe(0);
      }
      const { count: tiles } = await service.from('dashboard_tiles').select('id', { count: 'exact', head: true }).eq('dashboard_id', dashboard.id);
      expect(tiles).toBe(0);
    });
  });
});
