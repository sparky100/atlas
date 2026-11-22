/** Platform-admin view of a published sample model and its withdrawal state. */
export interface SampleModelWithdrawalEventRow {
  id: string;
  slug: string;
  action: 'withdrawn' | 'reinstated';
  reason: string | null;
  actor_id: string;
  happened_at: string;
}

export interface SampleModelAdminSummary {
  slug: string;
  name: string;
  description: string | null;
  latestVersion: number;
  publishedAt: string;
  /** True when the latest withdrawal event is `reinstated`, or there is no event. */
  shared: boolean;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  reinstatedAt: string | null;
}

export const SAMPLE_WITHDRAWAL_REASON_MAX = 500;
