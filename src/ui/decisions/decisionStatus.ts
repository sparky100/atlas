import type { DecisionStatus } from '../../db/types';
import type { ChipTone } from '../components/Chip/Chip';

/** Status → chip tone, the decisions list/page's own equivalent of `branchStatus.ts`'s `branchStatusTone` — never colour-only (§6.3/§8.4/§8.7: `Chip` always pairs tone with the status label itself). */
export function decisionStatusTone(status: DecisionStatus): ChipTone {
  switch (status) {
    case 'proposed':
      return 'neutral';
    case 'accepted':
      return 'ok';
    // Cancelled (`atlas.cancel_decision`): closed without a choice — not an
    // error, the same `neutral` a cancelled change uses.
    case 'rejected':
      return 'neutral';
    // A decision is never deleted, only superseded (ADR-013) — closed, not
    // an error, the same `neutral` tone `branchStatusTone`'s own
    // `cancelled`/`archived` cases use for the same reason.
    case 'superseded':
      return 'neutral';
  }
}

/**
 * Status as shown. `rejected` is stored by `atlas.cancel_decision` and reads
 * as "cancelled" (ADR-022 amendment, 2026-10-03) — the word people use for
 * a decision that was dropped rather than decided. The others show as stored.
 */
export { decisionStatusLabel } from '../../engine/decisionDigest/decisionStatusLabel';

/** One plain sentence on what the status means, shown beside it so the state is never just a small grey word. */
export function decisionStatusMeaning(status: DecisionStatus): string {
  switch (status) {
    case 'proposed':
      return 'Open: no option has been chosen yet.';
    case 'accepted':
      return 'Chosen: an option was chosen and the reasons are recorded.';
    case 'rejected':
      return 'Cancelled: closed without choosing an option.';
    case 'superseded':
      return 'Superseded: a later decision replaces this one.';
  }
}
