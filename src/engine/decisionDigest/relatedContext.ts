/** Pure decision-pack context, shared by the page and the reviewer endpoint. */
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import type { DecisionPrincipleRow, PrincipleRow, PrincipleStance } from '../../contracts/principles';

export function adrPrincipleItems(principles: readonly PrincipleRow[], links: readonly DecisionPrincipleRow[]): { title: string; stance: PrincipleStance; reason: string }[] {
  const byId = new Map(principles.map((p) => [p.id, p]));
  return links
    .map((l) => ({ title: byId.get(l.principle_id)?.title, stance: l.stance, reason: l.reason }))
    .filter((x): x is { title: string; stance: PrincipleStance; reason: string } => x.title !== undefined)
    .sort((a, b) => Number(a.stance === 'departs') - Number(b.stance === 'departs') || a.title.localeCompare(b.title));
}

export function goalTitlesServedBy(capabilityIds: readonly string[], goals: readonly GoalRow[], links: readonly GoalCapabilityRow[]): string[] {
  const wanted = new Set(capabilityIds);
  const goalIds = new Set(links.filter((l) => wanted.has(l.capability_id)).map((l) => l.goal_id));
  return goals.filter((g) => g.status === 'active' && goalIds.has(g.id)).map((g) => g.title).sort((a, b) => a.localeCompare(b));
}
