import { DECISION_CRITERIA, decisionCriterionLevelLabel } from '../../contracts/decisionCriteria';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow, DecisionArgumentRow, DecisionLinkRow, DecisionOptionRatingRow, DecisionRow } from '../../db/types';
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

/** The decision's options — its `branch` links, resolved, in link order. */
export function decisionOptionBranches(links: readonly DecisionLinkRow[], linkedBranchesById: ReadonlyMap<UUID, BranchRow>): BranchRow[] {
  return links
    .filter((l) => l.linked_type === 'branch')
    .map((l) => linkedBranchesById.get(l.linked_id))
    .filter((b): b is BranchRow => b !== undefined);
}

/** One option's recorded ratings, in `DECISION_CRITERIA`'s presentation order, with display labels. */
export function optionRatingsFor(ratings: readonly Pick<DecisionOptionRatingRow, 'branch_id' | 'criterion' | 'level' | 'note'>[], branchId: UUID): DecisionAdrExportOptionRating[] {
  return DECISION_CRITERIA.map((criterion) => {
    const rating = ratings.find((r) => r.branch_id === branchId && r.criterion === criterion.key);
    if (!rating) return null;
    return { criterionLabel: criterion.label, levelLabel: decisionCriterionLevelLabel(criterion.key, rating.level) ?? rating.level, note: rating.note };
  }).filter((r): r is NonNullable<typeof r> => r !== null);
}

export interface DecisionAdrSource {
  decision: DecisionRow;
  links: readonly DecisionLinkRow[];
  linkedElementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  linkedBranchesById: ReadonlyMap<UUID, BranchRow>;
  args: readonly DecisionArgumentRow[];
  ratings: readonly (DecisionOptionRatingRow | Pick<DecisionOptionRatingRow, 'branch_id' | 'criterion' | 'level' | 'note'>)[];
  /** The principles the decision follows or departs from (`adrPrincipleItems`); omitted or empty prints nothing. */
  principles?: DecisionAdrExportInput['principles'];
  /** Titles of the goals the concerned capabilities serve (`goalTitlesServedBy`); omitted or empty prints nothing. */
  goalsServed?: DecisionAdrExportInput['goalsServed'];
  /** Only the What-changes rows the table shows (`groupWhatChangesRows(...).visible`). */
  whatChangesRows: readonly WhatChangesRow[];
  ownerName: string;
}

export function buildDecisionAdrExportInput(source: DecisionAdrSource): DecisionAdrExportInput {
  const { decision, links, linkedElementsById, linkedBranchesById, args, ratings, whatChangesRows, ownerName, principles, goalsServed } = source;
  const { capabilityIds, otherElementIds } = decisionConcernIds(links, linkedElementsById);
  return {
    decision,
    ownerName,
    concerns: [...capabilityIds, ...otherElementIds]
      .map((id) => linkedElementsById.get(id))
      .filter((e): e is ElementsHeadRow => e !== undefined)
      .map((e) => ({ name: e.name, typeLabel: e.element_type })),
    options: decisionOptionBranches(links, linkedBranchesById).map((b) => ({ branch: b, isChosen: b.id === decision.branch_id, ratings: optionRatingsFor(ratings, b.id) })),
    whatChangesRows,
    ...(principles !== undefined ? { principles } : {}),
    ...(goalsServed !== undefined ? { goalsServed } : {}),
    // The one `stance: 'for'` row `atlas.choose_decision_option` writes — null until decided.
    reasons: args.find((a) => a.stance === 'for')?.body ?? null,
  };
}
