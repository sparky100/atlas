import type { DecisionRow, DecisionStatus } from '../../db/types';

export interface DecisionsListSection {
  key: DecisionStatus;
  title: string;
  decisions: DecisionRow[];
  /** Open on arrival: decisions still being made, and ones made. Cancelled and superseded start collapsed. */
  defaultOpen: boolean;
}

const SECTIONS: readonly { key: DecisionStatus; title: string; defaultOpen: boolean }[] = [
  { key: 'proposed', title: 'Proposed', defaultOpen: true },
  { key: 'accepted', title: 'Accepted', defaultOpen: true },
  { key: 'rejected', title: 'Cancelled', defaultOpen: false },
  { key: 'superseded', title: 'Superseded', defaultOpen: false },
];

/**
 * The Decisions list's sections, the same shape as the Changes list: the ones
 * still open first, ended ones collapsed. Empty sections are left out. Order
 * inside a section is the order given (newest first). Pure, so it is
 * unit-tested on its own.
 */
export function groupDecisionsList(decisions: readonly DecisionRow[]): DecisionsListSection[] {
  return SECTIONS.map((s) => ({ ...s, decisions: decisions.filter((d) => d.status === s.key) })).filter((s) => s.decisions.length > 0);
}
