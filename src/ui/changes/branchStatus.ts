import type { BranchStatus } from '../../db/types';
import type { ChipTone } from '../components/Chip/Chip';

/** Status → chip tone, shared between the changes list and the change page — never colour-only (§6.3/§8.4/§8.7: `Chip` always pairs tone with the status label itself). */
export function branchStatusTone(status: BranchStatus): ChipTone {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'proposed':
    case 'in_review':
      return 'info';
    case 'approved':
    case 'merged':
      return 'ok';
    case 'rejected':
      return 'danger';
    case 'archived':
      return 'neutral';
    // S1 item 4: a proposer's or owner/architect's own deliberate call to
    // stop, not a failure the way `rejected` is — `neutral`, the same tone
    // `draft`/`archived` already use for "closed, not colour-coded as an
    // error."
    case 'cancelled':
      return 'neutral';
  }
}
