/**
 * Pure logic for the Goals page (ADR-035). No I/O.
 */
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
export { goalTitlesServedBy } from '../../engine/decisionDigest/relatedContext';

export interface GoalCapabilityRef {
  capabilityId: string;
  name: string;
  /** How many systems and modules support it today (a plain count, never a score). */
  supporters: number;
}

export interface GoalSummary {
  goal: GoalRow;
  /** Linked capabilities still in the model, A to Z. */
  capabilities: GoalCapabilityRef[];
  /** Links whose capability is no longer in the model (removed since). Shown as a count so nothing disappears silently. */
  missing: number;
  /** Linked capabilities with no supporting system. */
  unsupported: number;
}

/** Each goal with its linked capabilities and how many systems support each. */
export function summariseGoals(goals: readonly GoalRow[], links: readonly GoalCapabilityRow[], capabilities: readonly Pick<ElementsHeadRow, 'element_id' | 'name'>[], supportsEdges: readonly Pick<RelationshipsHeadRow, 'from_element_id' | 'to_element_id'>[]): GoalSummary[] {
  const nameOf = new Map(capabilities.map((c) => [c.element_id, c.name]));
  const supporters = new Map<string, Set<string>>();
  for (const edge of supportsEdges) {
    const set = supporters.get(edge.to_element_id) ?? new Set<string>();
    set.add(edge.from_element_id);
    supporters.set(edge.to_element_id, set);
  }
  return goals.map((goal) => {
    const own = links.filter((l) => l.goal_id === goal.id);
    const linked = own.flatMap((l) => {
      const name = nameOf.get(l.capability_id);
      return name === undefined ? [] : [{ capabilityId: l.capability_id, name, supporters: supporters.get(l.capability_id)?.size ?? 0 }];
    });
    linked.sort((a, b) => a.name.localeCompare(b.name));
    return { goal, capabilities: linked, missing: own.length - linked.length, unsupported: linked.filter((c) => c.supporters === 0).length };
  });
}

/** Active goals first, each group A to Z by title. */
export function orderGoals(goals: readonly GoalRow[]): GoalRow[] {
  return [...goals].sort((a, b) => (a.status === b.status ? a.title.localeCompare(b.title) : a.status === 'active' ? -1 : 1));
}

/** Capabilities not yet linked to a goal, A to Z: what the "Add a capability" picker offers. */
export function linkableCapabilities(capabilities: readonly Pick<ElementsHeadRow, 'element_id' | 'name'>[], linkedIds: ReadonlySet<string>): { id: string; name: string }[] {
  return capabilities
    .filter((c) => !linkedIds.has(c.element_id))
    .map((c) => ({ id: c.element_id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The goals a capability serves, A to Z, active ones only (a retired goal is not why it matters today). */
export function goalsForCapability(capabilityId: string, goals: readonly GoalRow[], links: readonly GoalCapabilityRow[]): GoalRow[] {
  const ids = new Set(links.filter((l) => l.capability_id === capabilityId).map((l) => l.goal_id));
  return goals.filter((g) => g.status === 'active' && ids.has(g.id)).sort((a, b) => a.title.localeCompare(b.title));
}

export function countText(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The capabilities a goal is linked to (for the capability map's "Show goal"). */
export function capabilityIdsForGoal(goalId: string, links: readonly GoalCapabilityRow[]): Set<string> {
  return new Set(links.filter((l) => l.goal_id === goalId).map((l) => l.capability_id));
}

/** Active goals with no capability linked yet: a plain count for the homes, never a score. */
export function countGoalsWithoutCapability(goals: readonly GoalRow[], links: readonly GoalCapabilityRow[]): number {
  const linked = new Set(links.map((l) => l.goal_id));
  return goals.filter((g) => g.status === 'active' && !linked.has(g.id)).length;
}

/** The titles of the active goals served by any of these capabilities (a decision's concerns), A to Z, each once. */
