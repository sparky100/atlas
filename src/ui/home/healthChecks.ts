import type { HealthFindingItem, HealthFindingSeverity } from '../components/HealthFinding/healthFindingFormat';
import type { DecisionPrefill } from '../decisions/decisionPrefill';

/**
 * S1 item 7: "Zero-count findings collapse to one line ('N checks clear')
 * with expand." One `HealthCheck` is one finding as `HealthFinding` already
 * renders it (a caller-formatted `summary`, its `items`, an optional browse
 * link) — this module only decides which checks are worth their own plate
 * and which get rolled into the single "N checks clear" line.
 */
export interface HealthCheck {
  /** Stable per-check identity for React keys — the finding's browse
   * filter where it has one, an arbitrary slug otherwise. */
  key: string;
  count: number;
  summary: string;
  items: readonly HealthFindingItem[];
  /** Sprint U4-1 findings follow-up: passed straight through to `HealthFinding`'s own tint — see `HealthFindingSeverity`'s doc comment (`healthFindingFormat.ts`) for the tier definitions and `ArchitectHome.tsx`'s own check list for which finding gets which tier and why. */
  severity: HealthFindingSeverity;
  browseHref?: string;
  browseLabel?: string;
  /**
   * Architect-door layout prompt's per-item-actions answer: a
   * decision-shaped finding's own single-item "Start a decision" builder.
   * `ArchitectHome.tsx`'s `resolveCardAction` only ever calls this when
   * `count === 1` (`items[0]` is the one and only finding) — a multi-item
   * decision-shaped finding falls through to `browseHref` instead, so its
   * card's one action opens the filtered browse list, where every row
   * carries its own pre-filled "Start a decision" (`ElementBrowseTable.tsx`'s
   * `decisionRowAction`). Replaces the old `itemAction` (a per-row action
   * inside `HealthFinding`'s now-removed expand/paginate list — no room for
   * that in the compact 2-line card this field renders into).
   */
  decisionBuilder?: (item: HealthFindingItem) => DecisionPrefill;
}

export interface PartitionedHealthChecks {
  /** Zero-count checks first: item 6's own BlueprintFrame-on-the-first-plate
   * convention keeps its meaning (the first *real* finding) once the
   * zero-count ones no longer take up a plate of their own. */
  active: HealthCheck[];
  clear: HealthCheck[];
}

/** High first, then medium, then informational — `Array#sort` is stable, so checks within the same tier keep the order the caller listed them in. */
const SEVERITY_RANK: Record<HealthFindingSeverity, number> = { high: 0, medium: 1, informational: 2 };

export function partitionHealthChecks(checks: readonly HealthCheck[]): PartitionedHealthChecks {
  const active: HealthCheck[] = [];
  const clear: HealthCheck[] = [];
  for (const check of checks) {
    (check.count === 0 ? clear : active).push(check);
  }
  // Sprint U4-1 findings follow-up: only `active` is severity-ordered —
  // `clear` is already de-prioritised (collapsed behind "N checks clear"),
  // so reordering it would just churn that list for no visible benefit.
  active.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { active, clear };
}

/** "1 check clear" / "N checks clear" — the collapsed line's own title,
 * doubling as this group's "No findings" line once every check is zero
 * (`active` then has nothing to render at all). */
export function checksClearLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'check' : 'checks'} clear`;
}
