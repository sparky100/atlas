/**
 * Pure logic for principles on a decision (ADR-034 PR 3). No I/O.
 */
import type { DecisionPrincipleRow, PrincipleRow, PrincipleStance } from '../../contracts/principles';

export interface DecisionPrincipleLine {
  principle: PrincipleRow;
  /** `null` while the decision takes no view on this principle. */
  stance: PrincipleStance | null;
  reason: string;
}

/**
 * What the decision page lists. While the decision can still be edited it is every active principle (so a
 * person can take a view on each), plus any retired one the decision already cites; once decided it is only the
 * principles the decision actually cites. Active first, then A to Z by title.
 */
export function decisionPrincipleLines(principles: readonly PrincipleRow[], links: readonly DecisionPrincipleRow[], editable: boolean): DecisionPrincipleLine[] {
  const linkOf = new Map(links.map((l) => [l.principle_id, l]));
  return principles
    .filter((p) => linkOf.has(p.id) || (editable && p.status === 'active'))
    .map((principle) => {
      const link = linkOf.get(principle.id);
      return { principle, stance: link?.stance ?? null, reason: link?.reason ?? '' };
    })
    .sort((a, b) => Number(a.principle.status === 'retired') - Number(b.principle.status === 'retired') || a.principle.title.localeCompare(b.principle.title));
}

/** The decision's cited principles as the ADR export lists them: follows first, then departures, each A to Z. */
export function adrPrincipleItems(principles: readonly PrincipleRow[], links: readonly DecisionPrincipleRow[]): { title: string; stance: PrincipleStance; reason: string }[] {
  const byId = new Map(principles.map((p) => [p.id, p]));
  return links
    .map((l) => ({ title: byId.get(l.principle_id)?.title, stance: l.stance, reason: l.reason }))
    .filter((x): x is { title: string; stance: PrincipleStance; reason: string } => x.title !== undefined)
    .sort((a, b) => Number(a.stance === 'departs') - Number(b.stance === 'departs') || a.title.localeCompare(b.title));
}

/**
 * How many decisions depart from at least one principle. A cancelled decision (`rejected`) no longer counts: it
 * was never taken. Links whose decision is not in the list (another model's) are ignored.
 */
export function countDecisionsDeparting(links: readonly DecisionPrincipleRow[], decisions: readonly { id: string; status: string }[]): number {
  const live = new Set(decisions.filter((d) => d.status !== 'rejected').map((d) => d.id));
  return new Set(links.filter((l) => l.stance === 'departs' && live.has(l.decision_id)).map((l) => l.decision_id)).size;
}
