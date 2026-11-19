import type { DecisionStatus } from '../../db/types';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** "No capabilities named yet" or "3 capabilities and systems". */
export function scopeSummary(scopeCount: number): string {
  return scopeCount === 0 ? 'nothing named yet' : plural(scopeCount, 'item', 'items');
}

/** "none yet", "1 proposed", "1 proposed, 2 accepted" — cancelled and superseded are left out, they are history. */
export function decisionsSummary(statuses: readonly DecisionStatus[]): string {
  const proposed = statuses.filter((s) => s === 'proposed').length;
  const accepted = statuses.filter((s) => s === 'accepted').length;
  const parts = [proposed > 0 ? `${String(proposed)} proposed` : null, accepted > 0 ? `${String(accepted)} accepted` : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : statuses.length > 0 ? 'all closed' : 'none yet';
}

/** "none yet" or "4 changes". */
export function changesSummary(changeCount: number): string {
  return changeCount === 0 ? 'none yet' : plural(changeCount, 'change', 'changes');
}

/** "none yet" or "2 pieces". */
export function evidenceSummary(count: number): string {
  return count === 0 ? 'none yet' : plural(count, 'item', 'items');
}
