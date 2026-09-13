import type { DecisionStatus } from '../../db/types';
import type { ChipTone } from '../components/Chip/Chip';

/** Status → chip tone, the decisions list/page's own equivalent of `branchStatus.ts`'s `branchStatusTone` — never colour-only (§6.3/§8.4/§8.7: `Chip` always pairs tone with the status label itself). */
export function decisionStatusTone(status: DecisionStatus): ChipTone {
  switch (status) {
    case 'proposed':
      return 'neutral';
    case 'accepted':
      return 'ok';
    case 'rejected':
      return 'danger';
    // A decision is never deleted, only superseded (ADR-013) — closed, not
    // an error, the same `neutral` tone `branchStatusTone`'s own
    // `cancelled`/`archived` cases use for the same reason.
    case 'superseded':
      return 'neutral';
  }
}
