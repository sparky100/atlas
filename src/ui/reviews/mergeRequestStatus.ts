import type { MergeRequestStatus } from '../../db/types';
import type { ChipTone } from '../components/Chip/Chip';

/** Status → chip tone for a merge request — mirrors src/ui/changes/branchStatus.ts's own convention (never colour-only, §6.3/§8.4/§8.7). */
export function mergeRequestStatusTone(status: MergeRequestStatus): ChipTone {
  switch (status) {
    case 'pending':
      return 'info';
    case 'changes_requested':
      return 'warn';
    case 'approved':
      return 'ok';
    case 'merged':
      return 'ok';
    case 'rejected':
      return 'danger';
  }
}
