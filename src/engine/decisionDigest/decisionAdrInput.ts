import type { DecisionAgentNote } from '../../contracts/decisionAgentNote';
import type { OptionSource } from '../../contracts/optionSource';
import { DECISION_CRITERIA, decisionCriterionLevelLabel } from '../../contracts/decisionCriteria';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow, DecisionArgumentRow, DecisionLinkRow, DecisionOptionRatingRow, DecisionOptionRow, DecisionRow } from '../../db/types';
import type { DecisionAdrExportInput, DecisionAdrExportOptionRating } from './exportDecisionAsAdr';
import type { WhatChangesRow } from './whatChangesType';

/**
 * The ADR export's input, assembled from a decision's already-loaded data —
 * shared by the decision page's "Copy as ADR markdown" and the project
 * pack's decision log (F13 step 2), so both say exactly the same thing
 * about a decision.
 */

/** A decision's concerns split the way the comparison needs them: capabilities, and systems/containers (F6.3 rule 5). */
export function decisionConcernIds(links: readonly DecisionLinkRow[], linkedElementsById: ReadonlyMap<UUID, ElementsHeadRow>): { capabilityIds: UUID[]; otherElementIds: UUID[] } {
  const elementIds = links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship').map((l) => l.linked_id);
  return {
    capabilityIds: elementIds.filter((id) => linkedElementsById.get(id)?.element_type === 'capability'),
    otherElementIds: elementIds.filter((id) => {
      const t = linkedElementsById.get(id)?.element_type;
      return t === 'system' || t === 'container';
    }),
  };
}

/** Legacy branch options from `decision_links`, for callers without candidate rows yet. */
export function decisionOptionBranches(links: readonly DecisionLinkRow[], linkedBranchesById: ReadonlyMap<UUID, BranchRow>): BranchRow[] {
  return links
    .filter((l) => l.linked_type === 'branch')
    .map((l) => linkedBranchesById.get(l.linked_id))
    .filter((b): b is BranchRow => b !== undefined);
}

type AdrRating = Pick<DecisionOptionRatingRow, 'branch_id' | 'criterion' | 'level' | 'note'> & { option_id?: UUID | null };

/** One option's recorded ratings, in `DECISION_CRITERIA`'s presentation order, with display labels. Option id wins; a legacy row with no option id falls back to its branch. */
export function optionRatingsFor(ratings: readonly AdrRating[], optionId: UUID | null | undefined, branchId: UUID | null | undefined): DecisionAdrExportOptionRating[] {
  return DECISION_CRITERIA.map((criterion) => {
    const rating = ratings.find((r) => ((optionId != null && r.option_id === optionId) || (r.option_id == null && branchId != null && r.branch_id === branchId)) && r.criterion === criterion.key);
    if (!rating) return null;
    return { criterionLabel: criterion.label, levelLabel: decisionCriterionLevelLabel(criterion.key, rating.level) ?? rating.level, note: rating.note };
  }).filter((r): r is NonNullable<typeof r> => r !== null);
}

export interface DecisionAdrSource {
  decision: DecisionRow;
  links: readonly DecisionLinkRow[];
  linkedElementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  linkedBranchesById: ReadonlyMap<UUID, BranchRow>;
  /** D1 stage 4: the decision's candidates, branchless ones included. Omitted only by the older reviewer digest, which still resolves branch links. */
  options?: readonly DecisionOptionRow[];
  args: readonly DecisionArgumentRow[];
  ratings: readonly (DecisionOptionRatingRow | AdrRating)[];
  /** The principles the decision follows or departs from (`adrPrincipleItems`); omitted or empty prints nothing. */
  principles?: DecisionAdrExportInput['principles'];
  /** Titles of the goals the concerned capabilities serve (`goalTitlesServedBy`); omitted or empty prints nothing. */
  goalsServed?: DecisionAdrExportInput['goalsServed'];
  /** Only the What-changes rows the table shows (`groupWhatChangesRows(...).visible`). */
  whatChangesRows: readonly WhatChangesRow[];
  ownerName: string;
  /** D2 PR 4: questions an AI reviewer drafted that a person kept. Optional/empty prints no section. */
  keptQuestions?: readonly DecisionAgentNote[];
  /** Catalogue and web citations saved with each candidate, by option id. Optional/empty prints no Sources block. */
  sourcesByOption?: ReadonlyMap<UUID, readonly OptionSource[]>;
  /** Legacy fallback for a source row saved before option ids were backfilled. */
  sourcesByBranch?: ReadonlyMap<UUID, readonly OptionSource[]>;
}

export function buildDecisionAdrExportInput(source: DecisionAdrSource): DecisionAdrExportInput {
  const { decision, links, linkedElementsById, linkedBranchesById, options, args, ratings, whatChangesRows, ownerName, principles, goalsServed, keptQuestions, sourcesByOption, sourcesByBranch } = source;
  const { capabilityIds, otherElementIds } = decisionConcernIds(links, linkedElementsById);
  const optionInputs = options === undefined
    ? decisionOptionBranches(links, linkedBranchesById).map((branch) => ({
        optionId: branch.id,
        title: branch.title ?? branch.name,
        about: branch.description ?? '',
        branch,
        approach: null,
        status: branch.status,
        isChosen: branch.id === decision.branch_id,
        sources: sourcesByBranch?.get(branch.id) ?? [],
        ratings: optionRatingsFor(ratings, null, branch.id),
      }))
    : options.map((option) => {
        const branch = option.branch_id === null ? null : (linkedBranchesById.get(option.branch_id) ?? null);
        const sources = sourcesByOption?.get(option.id) ?? (branch === null ? [] : (sourcesByBranch?.get(branch.id) ?? []));
        return {
          optionId: option.id,
          title: option.title,
          about: option.summary,
          approach: option.approach,
          branch,
          status: branch?.status ?? ('candidate' as const),
          isChosen: decision.chosen_option_id != null ? option.id === decision.chosen_option_id : branch !== null && branch.id === decision.branch_id,
          sources,
          ratings: optionRatingsFor(ratings, option.id, option.branch_id),
        };
      });
  return {
    decision,
    ownerName,
    concerns: [...capabilityIds, ...otherElementIds]
      .map((id) => linkedElementsById.get(id))
      .filter((e): e is ElementsHeadRow => e !== undefined)
      .map((e) => ({ name: e.name, typeLabel: e.element_type })),
    options: optionInputs.map((option) => ({
      optionId: option.optionId,
      title: option.title,
      about: option.about,
      branch: option.branch,
      approach: option.approach,
      status: option.status,
      isChosen: option.isChosen,
      ratings: option.ratings,
      ...(option.sources.length > 0 ? { sources: option.sources } : {}),
    })),
    whatChangesRows,
    ...(principles !== undefined ? { principles } : {}),
    ...(goalsServed !== undefined ? { goalsServed } : {}),
    ...(keptQuestions !== undefined ? { keptQuestions } : {}),
    // The one `stance: 'for'` row `atlas.choose_decision_option` writes — null until decided.
    reasons: args.find((a) => a.stance === 'for')?.body ?? null,
  };
}
