/**
 * Split out from HealthFinding.tsx so the component file only exports the
 * component — react-refresh/only-export-components' own rule (co-locating
 * a plain function/type export with a component risks breaking Fast
 * Refresh in dev).
 */
export interface HealthFindingItem {
  id: string;
  label: string;
}

/** "A, B, C, and 2 more" — the collapsed row's own first-three-names format (Sprint U4-1 B3). */
export function joinWithMore(items: readonly HealthFindingItem[], max = 3): string {
  const shown = items.slice(0, max).map((item) => item.label);
  const remaining = items.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')}, and ${String(remaining)} more` : shown.join(', ');
}
