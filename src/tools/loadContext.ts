/**
 * Builds the real `ToolContext`: reads of one model at one commit, made with
 * the caller's own client so row-level security decides what is visible
 * (ADR-028 §2). Each read happens once per question, lazily. Same
 * "read the model scope once, filter in memory" shape as the pages (rule 8):
 * no `.in()` over a list that grows with the model.
 */
import type { UUID } from '../contracts/delta';
import type { RelationshipsHeadRow } from '../contracts/rows';
import type { Client } from '../db/client';
import { listAllElements } from '../db/elementBrowse';
import { listFactsForCommit, loadElementsRetiredByOpenChanges } from '../db/healthFindings';
import { loadChangeSummary } from '../db/changeSummary';
import { listChangeBranches } from '../db/branches';
import { listDecisionsForModel, listOpenDecisionElementLinksForModel } from '../db/decisions';
import { listFactsForSubject } from '../db/elements';
import { listProjectsForModel } from '../db/projects';
import { listSavedReports } from '../db/reports';
import { selectAll } from '../db/selectAll';
import type { ModelSnapshot, ToolContext } from './types';

const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

async function loadSnapshot(supabase: Client, modelId: UUID, commitId: UUID): Promise<ModelSnapshot> {
  const relationshipsQuery = supabase.from('relationships_head').select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).order('relationship_id');
  const aliasesQuery = supabase.from('aliases').select('element_id, alias_value', { count: 'exact' }).eq('model_id', modelId).neq('alias_type', 'merged_id').order('id');
  const [elements, relationships, aliasRows] = await Promise.all([
    listAllElements(supabase, commitId),
    selectAll<RelationshipsHeadRow>(relationshipsQuery),
    selectAll<{ element_id: UUID; alias_value: string }>(aliasesQuery),
  ]);
  const aliases = new Map<UUID, string[]>();
  for (const row of aliasRows) {
    const list = aliases.get(row.element_id);
    if (list) list.push(row.alias_value);
    else aliases.set(row.element_id, [row.alias_value]);
  }
  return { elements, relationships, aliases };
}

export function createToolContext(supabase: Client, model: { id: UUID; name: string }, commitId: UUID): ToolContext {
  let snapshot: Promise<ModelSnapshot> | null = null;
  let reports: ReturnType<typeof listSavedReports> | null = null;
  let facts: ReturnType<typeof listFactsForCommit> | null = null;
  let retired: ReturnType<typeof loadElementsRetiredByOpenChanges> | null = null;
  let changes: ReturnType<typeof listChangeBranches> | null = null;
  let decisions: ReturnType<typeof listDecisionsForModel> | null = null;
  let decisionLinks: ReturnType<typeof listOpenDecisionElementLinksForModel> | null = null;
  let projects: ReturnType<typeof listProjectsForModel> | null = null;
  return {
    stamp: { modelId: model.id, modelName: model.name, ref: 'main', commitId },
    snapshot: () => (snapshot ??= loadSnapshot(supabase, model.id, commitId)),
    factsFor: (elementId) => listFactsForSubject(supabase, commitId, elementId),
    savedReports: () => (reports ??= listSavedReports(supabase, model.id)),
    allFacts: () => (facts ??= listFactsForCommit(supabase, commitId)),
    retiredByOpenChanges: () => (retired ??= loadElementsRetiredByOpenChanges(supabase, model.id)),
    changes: () => (changes ??= listChangeBranches(supabase, model.id)),
    decisions: () => (decisions ??= listDecisionsForModel(supabase, model.id)),
    openDecisionLinks: () => (decisionLinks ??= listOpenDecisionElementLinksForModel(supabase, model.id)),
    projects: () => (projects ??= listProjectsForModel(supabase, model.id)),
    changeImpact: (change) => loadChangeSummary(supabase, model.id, change),
    now: () => new Date(),
  };
}
