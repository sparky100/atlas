/**
 * Builds the real `ToolContext`: reads of one model at one commit, made with
 * the caller's own client so row-level security decides what is visible
 * (ADR-028 §2). Each read happens once per question, lazily. Same
 * "read the model scope once, filter in memory" shape as the pages (rule 8):
 * no `.in()` over a list that grows with the model.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from '../db/client';
import { listAllElements } from '../db/elementBrowse';
import { listFactsForCommit, loadElementsRetiredByOpenChanges } from '../db/healthFindings';
import { loadChangeSummary } from '../db/changeSummary';
import { listChangeBranches } from '../db/branches';
import { listDecisionsForModel, listOpenDecisionElementLinksForModel } from '../db/decisions';
import { listAllRelationships, listFactsForSubject } from '../db/elements';
import { listGoalLinksForGoals, listGoalsForModel } from '../db/goals';
import { getStaleAfterMonthsForModel } from '../db/organisations';
import { listPrincipleLinksForPrinciples, listPrinciplesForModel } from '../db/principles';
import { listProjectsForModel } from '../db/projects';
import { capabilityMapMatch, currentCatalogue, listCurrentCatalogueEntriesForCapability } from '../db/productCatalogue';
import { listSavedReports } from '../db/reports';
import { selectAll } from '../db/selectAll';
import { factsWithoutCost, snapshotWithoutCost } from './runCostExclusion';
import type { ModelSnapshot, RunCostSharing, ToolContext, ToolStamp } from './types';

async function loadSnapshot(supabase: Client, modelId: UUID, commitId: UUID): Promise<ModelSnapshot> {
  const aliasesQuery = supabase.from('aliases').select('element_id, alias_value', { count: 'exact' }).eq('model_id', modelId).neq('alias_type', 'merged_id').order('id');
  const [elements, relationships, aliasRows] = await Promise.all([
    listAllElements(supabase, commitId),
    listAllRelationships(supabase, commitId),
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

/**
 * `runCost` has no default on purpose: a caller must decide. With `'exclude'`
 * run cost is removed from the snapshot and the facts here, once, so no tool
 * can return it and none can answer a question from it.
 */
export function createToolContext(supabase: Client, model: { id: UUID; name: string }, commitId: UUID, options: { runCost: RunCostSharing; ref?: ToolStamp['ref'] }): ToolContext {
  const { runCost, ref = 'main' } = options;
  const exclude = runCost === 'exclude';
  let snapshot: Promise<ModelSnapshot> | null = null;
  let reports: ReturnType<typeof listSavedReports> | null = null;
  let facts: ReturnType<typeof listFactsForCommit> | null = null;
  let retired: ReturnType<typeof loadElementsRetiredByOpenChanges> | null = null;
  let staleMonths: Promise<number> | null = null;
  let changes: ReturnType<typeof listChangeBranches> | null = null;
  let decisions: ReturnType<typeof listDecisionsForModel> | null = null;
  let decisionLinks: ReturnType<typeof listOpenDecisionElementLinksForModel> | null = null;
  let projects: ReturnType<typeof listProjectsForModel> | null = null;
  let goals: ReturnType<typeof listGoalsForModel> | null = null;
  let goalLinks: ReturnType<typeof listGoalLinksForGoals> | null = null;
  let principles: ReturnType<typeof listPrinciplesForModel> | null = null;
  let principleLinks: ReturnType<typeof listPrincipleLinksForPrinciples> | null = null;
  return {
    stamp: { modelId: model.id, modelName: model.name, ref, commitId },
    runCost,
    snapshot: () => (snapshot ??= loadSnapshot(supabase, model.id, commitId).then((s) => (exclude ? snapshotWithoutCost(s) : s))),
    factsFor: async (elementId) => {
      const rows = await listFactsForSubject(supabase, commitId, elementId);
      return exclude ? factsWithoutCost(rows) : rows;
    },
    savedReports: () => (reports ??= listSavedReports(supabase, model.id)),
    allFacts: () => (facts ??= listFactsForCommit(supabase, commitId).then((rows) => (exclude ? factsWithoutCost(rows) : rows))),
    retiredByOpenChanges: () => (retired ??= loadElementsRetiredByOpenChanges(supabase, model.id)),
    staleAfterMonths: () => (staleMonths ??= getStaleAfterMonthsForModel(supabase, model.id)),
    changes: () => (changes ??= listChangeBranches(supabase, model.id)),
    decisions: () => (decisions ??= listDecisionsForModel(supabase, model.id)),
    openDecisionLinks: () => (decisionLinks ??= listOpenDecisionElementLinksForModel(supabase, model.id)),
    projects: () => (projects ??= listProjectsForModel(supabase, model.id)),
    goals: () => (goals ??= listGoalsForModel(supabase, model.id)),
    goalLinks: async () => (goalLinks ??= listGoalLinksForGoals(supabase, (await (goals ??= listGoalsForModel(supabase, model.id))).map((g) => g.id))),
    principles: () => (principles ??= listPrinciplesForModel(supabase, model.id)),
    principleLinks: async () => (principleLinks ??= listPrincipleLinksForPrinciples(supabase, (await (principles ??= listPrinciplesForModel(supabase, model.id))).map((p) => p.id))),
    changeImpact: (change) => loadChangeSummary(supabase, model.id, change),
    catalogueForCapability: async (templateRef) => {
      const match = await capabilityMapMatch(supabase, templateRef);
      if (!match) return null;
      const catalogue = await currentCatalogue(supabase, match.sector);
      if (!catalogue) return null;
      return { ...match, catalogueVersion: catalogue.version, entries: await listCurrentCatalogueEntriesForCapability(supabase, match) };
    },
    now: () => new Date(),
  };
}
