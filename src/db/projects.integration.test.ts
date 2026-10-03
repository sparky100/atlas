/**
 * ADR-024 (projects), F10 step 1, against a real local Supabase with real
 * RLS: `projects`/`project_links`, `decisions.project_id`,
 * `branches.project_id`, the P1–P4 rules, `atlas.set_decision_project`,
 * `atlas.set_project_status`, split keeping the project (P3), 'project'
 * comment anchors and decision links, and `atlas.delete_model` clearing
 * projects (and the `decision_option_ratings` it used to miss).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Delta } from '../contracts/delta';
import { cancelChange, createChangeBranch, getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createComment } from './comments';
import { commitToBranch } from './commits';
import { upsertDecisionRating } from './decisionRatings';
import { cancelDecision, createDecision, createDecisionLink, getDecision } from './decisions';
import { loadEnv } from './env';
import { archiveModel, createModel, deleteModel } from './models';
import { createOrganisation } from './organisations';
import {
  addProjectLink,
  createProject,
  getProject,
  listChangesForProject,
  listConstrainingDecisions,
  listDecisionsForProject,
  listProjectLinks,
  listProjectsForModel,
  removeProjectLink,
  setChangeProject,
  setDecisionProject,
  setProjectStatus,
  updateProject,
} from './projects';
import { getOrCreateManualSource } from './sources';
import { splitAndMergeSubset } from './split';
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

describe('projects (ADR-024) against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let otherContributor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let modelId: string;
  let sourceId: string;
  let elementId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('projects-owner');
    architect = await createSignedInUser('projects-architect');
    contributor = await createSignedInUser('projects-contributor');
    otherContributor = await createSignedInUser('projects-contributor2');
    viewer = await createSignedInUser('projects-viewer');
    outsider = await createSignedInUser('projects-outsider');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Projects Test Org', slug: `projects-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert([
      { org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id },
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: otherContributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]);
    if (memberError) throw new Error(`add members: ${memberError.message}`);

    modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Projects Test Model', slug: `projects-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
    const source = await getOrCreateManualSource(owner.client, { id: randomUUID(), orgId, modelId, userId: owner.id });
    sourceId = source.id;

    // One real element on main, for declared-scope links.
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch missing');
    elementId = randomUUID();
    const seed = await commitToBranch(owner.client, {
      modelId,
      branchId: main.id,
      expectedHeadCommitId: main.head_commit_id,
      envelope: {
        id: randomUUID(),
        branchId: main.id,
        parentCommitId: main.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: 'seed a capability',
        body: null,
        deltas: [{ kind: 'element.create', id: randomUUID(), elementId, elementType: 'capability', name: 'Housing Repairs', parentId: null, attributes: {}, sourceId, confidence: 1 }],
      },
    });
    if (!seed.ok) throw new Error(`seed: ${seed.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  async function newProject(by: TestUser, title = `Project ${randomUUID().slice(0, 8)}`) {
    return createProject(by.client, { id: randomUUID(), orgId, modelId, title, purpose: 'Replace the housing CRM.', ownerId: by.id, createdBy: by.id });
  }

  async function newChange(by: TestUser, projectId: string | null, intent: 'propose' | 'explore' = 'propose'): Promise<BranchRow> {
    const main = await getMainBranch(by.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch missing');
    return createChangeBranch(by.client, { id: randomUUID(), orgId, modelId, name: `proj-change-${randomUUID().slice(0, 8)}`, createdBy: by.id, intent, mainHeadCommitId: main.head_commit_id, projectId });
  }

  async function newDecision(by: TestUser, projectId: string | null) {
    return createDecision(by.client, { id: randomUUID(), orgId, modelId, title: `Decision ${randomUUID().slice(0, 8)}`, statement: 'Context', ownerId: by.id, createdBy: by.id, projectId });
  }

  describe('create and read (RLS)', () => {
    it('a contributor creates a project, always active; members read it; a viewer cannot create; an outsider sees nothing', async () => {
      const project = await newProject(contributor);
      expect(project.status).toBe('active');
      expect(project.closed_at).toBeNull();

      expect((await listProjectsForModel(viewer.client, modelId)).some((p) => p.id === project.id)).toBe(true);
      expect(await getProject(outsider.client, project.id)).toBeNull();
      await expect(newProject(viewer)).rejects.toThrow();
    });

    it('a project cannot be inserted already closed', async () => {
      const { error } = await contributor.client.from('projects').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, title: 'Sneaky', purpose: '', owner_id: contributor.id, status: 'closed', closed_by: contributor.id, closed_at: new Date().toISOString(), created_by: contributor.id });
      expect(error).not.toBeNull();
    });
  });

  describe('editing (§4)', () => {
    it('its creator, its owner and an org architect may edit it; another contributor may not; status is not client-writable', async () => {
      const project = await newProject(contributor);
      await updateProject(contributor.client, project.id, { purpose: 'Updated by creator.' });
      await expect(updateProject(otherContributor.client, project.id, { purpose: 'Not mine.' })).rejects.toThrow();
      await updateProject(architect.client, project.id, { ownerId: otherContributor.id });
      // Now the owner, so allowed.
      await updateProject(otherContributor.client, project.id, { targetDate: '2027-03-31' });

      const after = await getProject(viewer.client, project.id);
      expect(after?.purpose).toBe('Updated by creator.');
      expect(after?.owner_id).toBe(otherContributor.id);
      expect(after?.target_date).toBe('2027-03-31');

      const { error } = await contributor.client.from('projects').update({ status: 'closed' }).eq('id', project.id).select('id');
      expect(error).not.toBeNull();
    });
  });

  describe('status (§4, P4)', () => {
    it('active ⇄ on_hold freely; close is refused while a change or decision is open; cancel needs a reason; closed is terminal', async () => {
      const project = await newProject(contributor);
      expect((await setProjectStatus(contributor.client, project.id, 'on_hold')).status).toBe('updated');
      expect((await setProjectStatus(contributor.client, project.id, 'active')).status).toBe('updated');

      const change = await newChange(contributor, project.id);
      const decision = await newDecision(contributor, project.id);
      expect(await setProjectStatus(contributor.client, project.id, 'closed')).toEqual({ status: 'open_items' });
      await expect(setProjectStatus(contributor.client, project.id, 'cancelled')).rejects.toThrow(/say why/);
      // Another contributor cannot change its status at all.
      await expect(setProjectStatus(otherContributor.client, project.id, 'on_hold')).rejects.toThrow();

      // Close out the open items through their own actions, then close.
      await cancelChange(contributor.client, change.id, 'Not needed.');
      expect(await setProjectStatus(contributor.client, project.id, 'closed')).toEqual({ status: 'open_items' });
      await cancelDecision(contributor.client, decision.id, 'Not needed any more.');
      const closed = await setProjectStatus(contributor.client, project.id, 'closed');
      expect(closed.status).toBe('updated');
      if (closed.status !== 'updated') return;
      expect(closed.project.status).toBe('closed');
      expect(closed.project.closed_by).toBe(contributor.id);
      expect(closed.project.closed_at).not.toBeNull();

      await expect(setProjectStatus(contributor.client, project.id, 'active')).rejects.toThrow(/start a new project/);
      await expect(updateProject(contributor.client, project.id, { title: 'Too late' })).rejects.toThrow();
      // Nothing new can join a closed project.
      await expect(newChange(contributor, project.id)).rejects.toThrow();
      await expect(newDecision(contributor, project.id)).rejects.toThrow();
    });

    it('cancelling with a reason records it', async () => {
      const project = await newProject(contributor);
      const result = await setProjectStatus(contributor.client, project.id, 'cancelled', 'Funding withdrawn.');
      expect(result.status).toBe('updated');
      if (result.status === 'updated') expect(result.project.close_reason).toBe('Funding withdrawn.');
    });
  });

  describe('P1: an option follows its decision', () => {
    it('an option link must match its decision\'s project; set_decision_project moves the decision and its draft options together', async () => {
      const p = await newProject(contributor);
      const q = await newProject(contributor);
      const decision = await newDecision(contributor, p.id);

      const strayOption = await newChange(contributor, null, 'explore');
      await expect(createDecisionLink(contributor.client, { decisionId: decision.id, linkedType: 'branch', linkedId: strayOption.id, createdBy: contributor.id })).rejects.toThrow(/same project/);

      const option = await newChange(contributor, p.id, 'explore');
      await createDecisionLink(contributor.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: contributor.id });
      // An option cannot be moved on its own.
      await expect(setChangeProject(contributor.client, option.id, q.id)).rejects.toThrow(/move the decision instead/);

      const moved = await setDecisionProject(contributor.client, decision.id, q.id);
      expect(moved.project_id).toBe(q.id);
      expect((await getBranch(contributor.client, option.id))?.project_id).toBe(q.id);
      expect((await listDecisionsForProject(viewer.client, q.id)).map((d) => d.id)).toContain(decision.id);

      // Out of any project: a portfolio-level decision.
      await setDecisionProject(contributor.client, decision.id, null);
      expect((await getDecision(contributor.client, decision.id))?.project_id).toBeNull();
      expect((await getBranch(contributor.client, option.id))?.project_id).toBeNull();
    });

    it('refuses to move a decision whose option is already past draft in its current project', async () => {
      const p = await newProject(contributor);
      const q = await newProject(contributor);
      const decision = await newDecision(contributor, p.id);
      const option = await newChange(contributor, p.id, 'explore');
      await createDecisionLink(contributor.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: contributor.id });
      await service.from('branches').update({ status: 'proposed' }).eq('id', option.id); // test setup: an option already submitted

      await expect(setDecisionProject(contributor.client, decision.id, q.id)).rejects.toThrow(/already submitted or merged/);
      expect((await getDecision(contributor.client, decision.id))?.project_id).toBe(p.id);
    });

    it('only the decision\'s creator or an owner/architect may move it', async () => {
      const p = await newProject(contributor);
      const decision = await newDecision(contributor, null);
      await expect(setDecisionProject(otherContributor.client, decision.id, p.id)).rejects.toThrow();
      expect((await setDecisionProject(architect.client, decision.id, p.id)).project_id).toBe(p.id);
    });
  });

  describe('P2: a change\'s project changes only while the change is open', () => {
    it('an open change moves between projects; a cancelled one is frozen', async () => {
      const p = await newProject(contributor);
      const q = await newProject(contributor);
      const change = await newChange(contributor, null);
      await setChangeProject(contributor.client, change.id, p.id);
      await setChangeProject(contributor.client, change.id, q.id);
      // A draft change is visible to its author (a viewer sees it only once shared for review — existing branch RLS).
      expect((await listChangesForProject(contributor.client, q.id)).map((b) => b.id)).toContain(change.id);

      await cancelChange(contributor.client, change.id, 'Dropped.');
      await expect(setChangeProject(contributor.client, change.id, p.id)).rejects.toThrow(/can no longer change/);
    });

    it('main never belongs to a project', async () => {
      const p = await newProject(contributor);
      const main = await getMainBranch(owner.client, modelId);
      if (!main) throw new Error('main branch missing');
      await expect(setChangeProject(owner.client, main.id, p.id)).rejects.toThrow();
    });
  });

  describe('P3: split keeps the project', () => {
    it('the split-off change is in the same project as the original', async () => {
      const p = await newProject(owner);
      const branch = await newChange(owner, p.id);
      const acceptedId = randomUUID();
      const remainderId = randomUUID();
      const system = (id: string, name: string): Delta => ({ kind: 'element.create', id: randomUUID(), elementId: id, elementType: 'system', name, parentId: null, attributes: { lifecycleStatus: 'active', isExternal: false }, sourceId, confidence: 1 });
      const committed = await commitToBranch(owner.client, {
        modelId,
        branchId: branch.id,
        expectedHeadCommitId: branch.head_commit_id,
        envelope: { id: randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: 'two systems', body: null, deltas: [system(acceptedId, 'Accepted'), system(remainderId, 'Remainder')] },
      });
      expect(committed.ok).toBe(true);
      const branchAfter = await getBranch(owner.client, branch.id);
      const main = await getMainBranch(owner.client, modelId);
      if (!branchAfter || !main?.head_commit_id) throw new Error('fixture missing');

      const split = await splitAndMergeSubset(owner.client, { modelId, branch: branchAfter, mainHeadCommitId: main.head_commit_id, requestedSubjectIds: new Set([acceptedId]), splitBranchName: `split-${randomUUID().slice(0, 8)}`, splitBranchTitle: 'Split: Accepted' });
      expect(split.ok).toBe(true);
      if (!split.ok) return;
      expect(split.splitBranch.project_id).toBe(p.id);
    });
  });

  describe('project links and decision links', () => {
    it('declared scope takes a real element, can be removed while open, and is editable only by those who may edit the project', async () => {
      const p = await newProject(contributor);
      await addProjectLink(contributor.client, { projectId: p.id, linkedType: 'element', linkedId: elementId, createdBy: contributor.id });
      await expect(addProjectLink(contributor.client, { projectId: p.id, linkedType: 'element', linkedId: randomUUID(), createdBy: contributor.id })).rejects.toThrow(/no element/);
      await expect(addProjectLink(viewer.client, { projectId: p.id, linkedType: 'element', linkedId: elementId, createdBy: viewer.id })).rejects.toThrow();
      expect((await listProjectLinks(viewer.client, p.id)).map((l) => l.linked_id)).toEqual([elementId]);

      await expect(removeProjectLink(otherContributor.client, p.id, 'element', elementId)).rejects.toThrow();
      await removeProjectLink(contributor.client, p.id, 'element', elementId);
      expect(await listProjectLinks(viewer.client, p.id)).toEqual([]);
    });

    it('evidence attaches to a project', async () => {
      const p = await newProject(contributor);
      const evidenceId = randomUUID();
      const { error } = await contributor.client.from('evidence').insert({ id: evidenceId, org_id: orgId, model_id: modelId, kind: 'link', pointer: 'https://example.test/business-case', description: 'Business case', added_by: contributor.id });
      if (error) throw new Error(`evidence: ${error.message}`);
      await addProjectLink(contributor.client, { projectId: p.id, linkedType: 'evidence', linkedId: evidenceId, createdBy: contributor.id });
      expect((await listProjectLinks(viewer.client, p.id)).map((l) => l.linked_type)).toEqual(['evidence']);
    });

    it('a decision may constrain a project it is not part of, never its own', async () => {
      const p = await newProject(contributor);
      const constraining = await newDecision(contributor, null);
      await createDecisionLink(contributor.client, { decisionId: constraining.id, linkedType: 'project', linkedId: p.id, createdBy: contributor.id });
      expect((await listConstrainingDecisions(viewer.client, p.id)).map((d) => d.id)).toEqual([constraining.id]);

      const member = await newDecision(contributor, p.id);
      await expect(createDecisionLink(contributor.client, { decisionId: member.id, linkedType: 'project', linkedId: p.id, createdBy: contributor.id })).rejects.toThrow(/already part of that project/);
    });
  });

  describe('comments', () => {
    it('a project carries its own comment thread; a missing project is not an anchor', async () => {
      const p = await newProject(contributor);
      const comment = await createComment(otherContributor.client, { id: randomUUID(), orgId, modelId, anchorType: 'project', anchorId: p.id, body: 'When does this start?', authorId: otherContributor.id });
      expect(comment.anchor_type).toBe('project');
      // Every member reads the thread (comment_visible_to_viewer → anchor_visible_to_viewer's 'project' case).
      const { data: visible } = await viewer.client.from('comments').select('id').eq('anchor_type', 'project').eq('anchor_id', p.id);
      expect(visible?.map((c: { id: string }) => c.id)).toEqual([comment.id]);
      await expect(createComment(otherContributor.client, { id: randomUUID(), orgId, modelId, anchorType: 'project', anchorId: randomUUID(), body: 'Nowhere', authorId: otherContributor.id })).rejects.toThrow();
    });
  });
});

describe('atlas.delete_model clears projects and decision ratings', () => {
  it('deletes an archived model holding a project, a decision in it, an option and a rating', async () => {
    const owner = await createSignedInUser('projects-delete-owner');
    const orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Projects Delete Org', slug: `projdel-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Projects Delete Model', slug: `projdel-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const project = await createProject(owner.client, { id: randomUUID(), orgId, modelId, title: 'To be deleted', purpose: '', ownerId: owner.id, createdBy: owner.id });
    const decision = await createDecision(owner.client, { id: randomUUID(), orgId, modelId, title: 'Which way?', statement: '', ownerId: owner.id, createdBy: owner.id, projectId: project.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('main branch missing');
    const option = await createChangeBranch(owner.client, { id: randomUUID(), orgId, modelId, name: `projdel-option-${randomUUID().slice(0, 8)}`, createdBy: owner.id, intent: 'explore', mainHeadCommitId: main.head_commit_id, projectId: project.id });
    await createDecisionLink(owner.client, { decisionId: decision.id, linkedType: 'branch', linkedId: option.id, createdBy: owner.id });
    await upsertDecisionRating(owner.client, { decisionId: decision.id, branchId: option.id, criterion: 'cost', level: 'favourable', note: null, ratedBy: owner.id });
    await createComment(owner.client, { id: randomUUID(), orgId, modelId, anchorType: 'project', anchorId: project.id, body: 'Kick-off notes', authorId: owner.id });

    await archiveModel(owner.client, modelId);
    expect(await deleteModel(owner.client, modelId)).toEqual({ status: 'deleted' });
    const { data: leftover } = await service.from('projects').select('id').eq('model_id', modelId);
    expect(leftover).toEqual([]);

    await service.from('organisations').delete().eq('id', orgId);
  });
});
