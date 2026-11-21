/**
 * Status as shown. `rejected` is stored by `atlas.cancel_decision` and reads
 * as "cancelled" (ADR-022 amendment, 2026-10-03) — the word people use for a
 * decision that was dropped rather than decided. The others show as stored.
 *
 * Server-safe copy of `src/ui/decisions/decisionStatus.ts`'s
 * `decisionStatusLabel` (that file re-exports this one), so the ADR
 * formatter and reviewer digest never import UI code. Keep the two in step.
 */
import type { DecisionStatus } from '../../db/types';

export function decisionStatusLabel(status: DecisionStatus): string {
  return status === 'rejected' ? 'cancelled' : status;
}
