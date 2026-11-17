/**
 * Pure logic for the Principles page (ADR-034). No I/O.
 */
import type { DecisionPrincipleRow, PrincipleRow } from '../../contracts/principles';
import type { DecisionRow } from '../../db/types';

export interface PrincipleDecisionRef {
  decisionId: string;
  title: string;
}

export interface PrincipleDeparture extends PrincipleDecisionRef {
  reason: string;
}

export interface PrincipleSummary {
  principle: PrincipleRow;
  followed: PrincipleDecisionRef[];
  departed: PrincipleDeparture[];
}

/** Each principle with the decisions that follow it and the ones that depart from it (with their reasons), titles A to Z. A link whose decision isn't in the list is left out. */
export function summarisePrinciples(principles: readonly PrincipleRow[], links: readonly DecisionPrincipleRow[], decisions: readonly Pick<DecisionRow, 'id' | 'title'>[]): PrincipleSummary[] {
  const titleOf = new Map(decisions.map((d) => [d.id, d.title]));
  const byTitle = (a: PrincipleDecisionRef, b: PrincipleDecisionRef) => a.title.localeCompare(b.title);
  return principles.map((principle) => {
    const own = links.filter((l) => l.principle_id === principle.id && titleOf.has(l.decision_id));
    const followed = own.filter((l) => l.stance === 'follows').map((l) => ({ decisionId: l.decision_id, title: titleOf.get(l.decision_id) ?? '' })).sort(byTitle);
    const departed = own.filter((l) => l.stance === 'departs').map((l) => ({ decisionId: l.decision_id, title: titleOf.get(l.decision_id) ?? '', reason: l.reason })).sort(byTitle);
    return { principle, followed, departed };
  });
}

/** Active principles first, each group A to Z by title. */
export function orderPrinciples(principles: readonly PrincipleRow[]): PrincipleRow[] {
  return [...principles].sort((a, b) => (a.status === b.status ? a.title.localeCompare(b.title) : a.status === 'active' ? -1 : 1));
}

export function countText(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}
