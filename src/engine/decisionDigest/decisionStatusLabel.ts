import type { DecisionStatus } from '../../db/types';

/** The stored rejected state is shown to people as cancelled. */
export function decisionStatusLabel(status: DecisionStatus): string {
  return status === 'rejected' ? 'cancelled' : status;
}
