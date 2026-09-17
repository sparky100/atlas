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

/**
 * Sprint U4-1 findings follow-up: how strongly a non-zero finding's own
 * plate is tinted — a flat "count > 0" background (the original Visual
 * pass shape) treated every finding as equally alarming, from "no business
 * owner on a critical system" down to "external organisation has access"
 * (purely informational). `high` is a strong amber/red tint, `medium` a
 * light one (the original tint, kept for this tier), `informational` none
 * at all. The caller (`healthChecks.ts`'s own `HealthCheck.severity`)
 * assigns this per finding; `HealthFinding` itself only renders it.
 */
export type HealthFindingSeverity = 'high' | 'medium' | 'informational';

/** "A, B, C, and 2 more" — the collapsed row's own first-three-names format (Sprint U4-1 B3). */
export function joinWithMore(items: readonly HealthFindingItem[], max = 3): string {
  const shown = items.slice(0, max).map((item) => item.label);
  const remaining = items.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')}, and ${String(remaining)} more` : shown.join(', ');
}
