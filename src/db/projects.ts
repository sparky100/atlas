/**
 * Project repository operations (ADR-024, F10 —
 * `docs/ADR-024-projects.md`, `supabase/migrations/20261002020000_projects.sql`).
 * Thin, typed wrappers over `projects`/`project_links` and the two project
 * RPCs. The consistency rules (P1–P4) live in the database; nothing here
 * re-checks them, same division of labour as `decisions.ts`.
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { BranchRow, DecisionRow, ProjectLinkedType, ProjectLinkRow, ProjectRow, ProjectStatus } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateProjectInput {
  /** Minted by the caller (S-1) — never generated here. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  title: string;
  purpose: string;
  ownerId: UUID;
  startDate?: string | null;
  targetDate?: string | null;
  sourceFindingKey?: string | null;
  createdBy: UUID;
}

export async function createProject(supabase: Client, input: CreateProjectInput): Promise<ProjectRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    title: input.title,
    purpose: input.purpose,
    owner_id: input.ownerId,
    start_date: input.startDate ?? null,
    target_date: input.targetDate ?? null,
    source_finding_key: input.sourceFindingKey ?? null,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('projects').insert(row).select('*').single();
  if (error) throw new Error(`createProject: ${error.message}`);
  return data as ProjectRow;
}

export async function getProject(supabase: Client, projectId: UUID): Promise<ProjectRow | null> {
  assertRealId('getProject', 'id', projectId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`getProject: ${error.message}`);
  return data as ProjectRow | null;
}

/** Every project on a model, newest first — the Projects list's own query. */
export async function listProjectsForModel(supabase: Client, modelId: UUID): Promise<ProjectRow[]> {
  assertRealId('listProjectsForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('projects').select('*').eq('model_id', modelId).order('created_at', { ascending: false });
  if (error) throw new Error(`listProjectsForModel: ${error.message}`);
  return data as ProjectRow[];
}

export interface UpdateProjectInput {
  title?: string;
  purpose?: string;
  ownerId?: UUID;
  startDate?: string | null;
  targetDate?: string | null;
}

/**
 * Edits a project's own fields — only its creator or owner, or an org
 * owner/architect, and only while active or on hold (RLS). A blocked
 * update is a zero-row success under RLS, so `.select('id')` turns it into
 * a real error rather than a silent no-op.
 */
export async function updateProject(supabase: Client, projectId: UUID, input: UpdateProjectInput): Promise<void> {
  assertRealId('updateProject', 'id', projectId);
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.purpose !== undefined) patch.purpose = input.purpose;
  if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
  if (input.startDate !== undefined) patch.start_date = input.startDate;
  if (input.targetDate !== undefined) patch.target_date = input.targetDate;
  const { data, error } = await supabase.from('projects').update(patch).eq('id', projectId).select('id');
  if (error) throw new Error(`updateProject: ${error.message}`);
  if (data.length === 0) throw new Error('updateProject: this project can no longer be edited, or you are not allowed to edit it');
}

export type SetProjectStatusResult = { status: 'updated'; project: ProjectRow } | { status: 'open_items' };

/**
 * `atlas.set_project_status` — `active ⇄ on_hold` freely; `closed`/
 * `cancelled` only with nothing open in the project (P4), `cancelled`
 * with a reason. `open_items` is the P4 refusal as a structured result:
 * the caller lists the open changes and decisions itself.
 */
export async function setProjectStatus(supabase: Client, projectId: UUID, status: ProjectStatus, reason?: string): Promise<SetProjectStatusResult> {
  assertRealId('setProjectStatus', 'id', projectId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_project_status', { p_project_id: projectId, p_status: status, p_reason: reason ?? null });
  if (error) {
    if (error.message.includes('OPEN_ITEMS')) return { status: 'open_items' };
    throw new Error(`setProjectStatus: ${error.message}`);
  }
  return { status: 'updated', project: data as ProjectRow };
}

/** `atlas.set_decision_project` — moves a proposed decision, with its draft option changes, into a project (or out, with `null`) (P1). */
export async function setDecisionProject(supabase: Client, decisionId: UUID, projectId: UUID | null): Promise<DecisionRow> {
  assertRealId('setDecisionProject', 'id', decisionId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_decision_project', { p_decision_id: decisionId, p_project_id: projectId });
  if (error) throw new Error(`setDecisionProject: ${error.message}`);
  return data as DecisionRow;
}

/**
 * Moves a change into a project (or out, with `null`). Only while the
 * change is open (P2); refused for a decision's option, which moves with
 * its decision instead (P1) — both enforced by `atlas.guard_branch_project`.
 */
export async function setChangeProject(supabase: Client, branchId: UUID, projectId: UUID | null): Promise<void> {
  assertRealId('setChangeProject', 'id', branchId);
  const { data, error } = await supabase.from('branches').update({ project_id: projectId }).eq('id', branchId).select('id');
  if (error) throw new Error(`setChangeProject: ${error.message}`);
  if (data.length === 0) throw new Error('setChangeProject: you are not allowed to change this change\'s project');
}

/** The project's decision log: decisions that are part of it. */
export async function listDecisionsForProject(supabase: Client, projectId: UUID): Promise<DecisionRow[]> {
  assertRealId('listDecisionsForProject', 'project_id', projectId);
  const { data, error } = await supabase.from('decisions').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw new Error(`listDecisionsForProject: ${error.message}`);
  return data as DecisionRow[];
}

/** Decisions that constrain this project without being part of it (`decision_links.linked_type = 'project'`). */
export async function listConstrainingDecisions(supabase: Client, projectId: UUID): Promise<DecisionRow[]> {
  assertRealId('listConstrainingDecisions', 'linked_id', projectId);
  const { data, error } = await supabase.from('decision_links').select('decisions(*)').eq('linked_type', 'project').eq('linked_id', projectId);
  if (error) throw new Error(`listConstrainingDecisions: ${error.message}`);
  return (data as unknown as { decisions: DecisionRow | null }[]).flatMap((r) => (r.decisions ? [r.decisions] : []));
}

/** The project's changes, oldest first. */
export async function listChangesForProject(supabase: Client, projectId: UUID): Promise<BranchRow[]> {
  assertRealId('listChangesForProject', 'project_id', projectId);
  const { data, error } = await supabase.from('branches').select('*').eq('project_id', projectId).order('updated_at', { ascending: true });
  if (error) throw new Error(`listChangesForProject: ${error.message}`);
  return data as BranchRow[];
}

export async function listProjectLinks(supabase: Client, projectId: UUID): Promise<ProjectLinkRow[]> {
  assertRealId('listProjectLinks', 'project_id', projectId);
  const { data, error } = await supabase.from('project_links').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw new Error(`listProjectLinks: ${error.message}`);
  return data as ProjectLinkRow[];
}

export interface AddProjectLinkInput {
  projectId: UUID;
  linkedType: ProjectLinkedType;
  linkedId: UUID;
  createdBy: UUID;
}

export async function addProjectLink(supabase: Client, input: AddProjectLinkInput): Promise<ProjectLinkRow> {
  const row = { project_id: input.projectId, linked_type: input.linkedType, linked_id: input.linkedId, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('project_links').insert(row).select('*').single();
  if (error) throw new Error(`addProjectLink: ${error.message}`);
  return data as ProjectLinkRow;
}

/** Removes an element from the declared scope (or an evidence link). The element itself is untouched. */
export async function removeProjectLink(supabase: Client, projectId: UUID, linkedType: ProjectLinkedType, linkedId: UUID): Promise<void> {
  assertRealId('removeProjectLink', 'project_id', projectId);
  const { data, error } = await supabase.from('project_links').delete().eq('project_id', projectId).eq('linked_type', linkedType).eq('linked_id', linkedId).select('project_id');
  if (error) throw new Error(`removeProjectLink: ${error.message}`);
  if (data.length === 0) throw new Error('removeProjectLink: this link could not be removed — the project may be closed, or you may not be allowed to edit it');
}

export interface TouchedElement {
  elementId: UUID;
  /** The name the change created it with, when the change created it; `null` for an existing element it only edited (the caller resolves those against main). */
  createdName: string | null;
}

/**
 * The elements one change's own commits touch (ADR-024 §5, "what the
 * project touches", derived, never stored). One query per change, filtered
 * by `commits.branch_id` through an inner embed — never an `.in()` over a
 * growing id list (CLAUDE.md rule 8). RLS applies: a viewer sees nothing
 * for another person's unshared draft.
 */
export async function listElementsTouchedByChange(supabase: Client, modelId: UUID, branchId: UUID): Promise<TouchedElement[]> {
  assertRealId('listElementsTouchedByChange', 'branch_id', branchId);
  const { data, error } = await supabase
    .from('deltas')
    .select('subject_id, kind, name, commits!inner(branch_id)')
    .eq('model_id', modelId)
    .eq('subject_type', 'element')
    .eq('commits.branch_id', branchId)
    .order('seq');
  if (error) throw new Error(`listElementsTouchedByChange: ${error.message}`);
  const byId = new Map<UUID, TouchedElement>();
  for (const row of data as unknown as { subject_id: UUID; kind: string; name: string | null }[]) {
    const existing = byId.get(row.subject_id);
    const createdName = row.kind === 'element_create' ? row.name : null;
    if (!existing) byId.set(row.subject_id, { elementId: row.subject_id, createdName });
    else if (createdName !== null) existing.createdName = createdName;
  }
  return [...byId.values()];
}
