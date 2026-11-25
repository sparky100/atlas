/**
 * F13 step 2: gathers what the project pack needs beyond what the project
 * page already holds — each decision's own ADR (the same data the decision
 * page loads for "Copy as ADR markdown": links, arguments, ratings and the
 * What-changes comparison) and each change's own summary. Read-only; the
 * pack is a rendering, never stored.
 *
 * No `.in()` over a growing list here (CLAUDE.md rule 8): every read is per
 * decision or model-scoped, reusing the queries those pages already run.
 */
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { loadChangeSummariesForModel } from '../../db/changeSummary';
import { listDecisionAgentNotes } from '../../db/decisionAgentNotes';
import { listDecisionRatingsForDecision } from '../../db/decisionRatings';
import { listOptionSources } from '../../db/productCatalogue';
import type { BranchRow, DecisionRow } from '../../db/types';
import { compareDecisionOptions } from '../decisions/compareOptions';
import { buildDecisionAdrExportInput, decisionConcernIds } from '../decisions/decisionAdrInput';
import { exportDecisionAsAdrMarkdown } from '../decisions/exportDecisionAsAdr';
import { intentHeaderLine } from '../changes/branchIntent';
import { loadDecisionPageData } from '../decisions/useDecision';
import { listPrinciplesForDecision, listPrinciplesForModel } from '../../db/principles';
import { listGoalLinksForGoals, listGoalsForModel } from '../../db/goals';
import { goalTitlesServedBy } from '../goals/goalModel';
import { adrPrincipleItems } from '../principles/decisionPrinciples';
import { groupWhatChangesRows } from '../decisions/whatChangesRows';
import { scopeDifference } from '../projects/projectModel';
import type { ProjectData } from '../projects/useProject';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';
import { supabase } from '../supabaseClient';
import type { ProjectPackDecision, ProjectPackInput } from './projectPack';

async function decisionAdr(modelId: UUID, mainHeadCommitId: UUID | null, decision: DecisionRow, nameOfUser: (id: UUID) => string): Promise<ProjectPackDecision> {
  const [page, ratings, principles, principleLinks, keptQuestions, sources] = await Promise.all([
    loadDecisionPageData(modelId, decision.id),
    listDecisionRatingsForDecision(supabase, decision.id),
    listPrinciplesForModel(supabase, modelId),
    listPrinciplesForDecision(supabase, decision.id),
    listDecisionAgentNotes(supabase, decision.id),
    listOptionSources(supabase, decision.id),
  ]);
  const goals = (await listGoalsForModel(supabase, modelId)).filter((g) => g.status === 'active');
  const goalLinks = await listGoalLinksForGoals(supabase, goals.map((g) => g.id));
  if (page.status !== 'ready') throw new Error(`Couldn't load the decision "${decision.title}".`);
  const { capabilityIds, otherElementIds } = decisionConcernIds(page.links, page.linkedElementsById);
  const optionBranches = page.options
    .map((option) => option.branch_id === null ? undefined : page.linkedBranchesById.get(option.branch_id))
    .filter((branch): branch is BranchRow => branch !== undefined);
  const options = optionBranches.map((b) => ({ branchId: b.id, baseCommitId: b.base_commit_id, headCommitId: b.head_commit_id, label: intentHeaderLine(b) }));
  const comparison = mainHeadCommitId && options.length > 0 ? await compareDecisionOptions(supabase, { modelId, mainHeadCommitId, capabilityIds, otherConcernElementIds: otherElementIds, options }) : null;
  const sourcesByOption = new Map<UUID, typeof sources>();
  for (const source of sources) {
    const list = sourcesByOption.get(source.optionId) ?? [];
    list.push(source);
    sourcesByOption.set(source.optionId, list);
  }
  const adrMarkdown = exportDecisionAsAdrMarkdown(
    buildDecisionAdrExportInput({
      decision: page.decision,
      links: page.links,
      linkedElementsById: page.linkedElementsById,
      linkedBranchesById: page.linkedBranchesById,
      options: page.options,
      args: page.args,
      ratings,
      principles: adrPrincipleItems(principles, principleLinks),
      goalsServed: goalTitlesServedBy(capabilityIds, goals, goalLinks),
      whatChangesRows: comparison ? groupWhatChangesRows(comparison.whatChangesRows).visible : [],
      keptQuestions,
      sourcesByOption,
      ownerName: nameOfUser(page.decision.owner_id),
    }),
  );
  return { decision: page.decision, adrMarkdown };
}

export async function loadProjectPack(args: { modelId: UUID; modelName: string; date: string; data: ProjectData; nameOfUser: (id: UUID) => string }): Promise<ProjectPackInput> {
  const { modelId, modelName, date, data, nameOfUser } = args;
  const { project, decisions, constrainingDecisions, changes, links, evidence, touched, elementsById } = data;
  const main = await getMainBranch(supabase, modelId);
  const mainHead = main?.head_commit_id ?? null;
  const [packDecisions, summaries] = await Promise.all([
    Promise.all(decisions.map((d) => decisionAdr(modelId, mainHead, d, nameOfUser))),
    loadChangeSummariesForModel(supabase, modelId, changes),
  ]);

  const elementName = (id: UUID) => {
    const element = elementsById.get(id);
    return element ? moduleDisplayNameFromMap(element, elementsById) : (touched.find((t) => t.elementId === id)?.createdName ?? 'An element not in the live model yet');
  };
  const scopeIds = links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id);
  const difference = scopeDifference(
    scopeIds,
    touched.map((t) => t.elementId),
    data.reachedIds,
  );

  return {
    modelName,
    date,
    project,
    ownerName: nameOfUser(project.owner_id),
    projectManagerName: project.project_manager_id ? nameOfUser(project.project_manager_id) : project.project_manager_name,
    scope: scopeIds.map((id) => ({ name: elementName(id), typeLabel: elementsById.get(id)?.element_type ?? 'element' })),
    touchedNotDeclared: difference.touchedNotDeclared.map(elementName),
    declaredNotTouched: difference.declaredNotTouched.map(elementName),
    decisions: packDecisions,
    constrainingDecisions,
    changes: changes.map((branch) => ({ branch, summary: summaries.get(branch.id) ?? null })),
    evidence,
  };
}
