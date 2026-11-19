import type { DecisionApprovalLens, DecisionApprovalRow } from '../../db/types';

export const LENS_LABELS: Record<DecisionApprovalLens, string> = {
  business_owner: 'Business owner',
  architecture: 'Architecture',
  delivery: 'Delivery',
  security: 'Security',
  data: 'Data',
  funding: 'Funding',
};

export interface PackSignOff {
  /** none: nobody has signed this version; declined: at least one decline; approved: at least one approve and no decline. */
  state: 'none' | 'approved' | 'declined';
  approvals: number;
  declines: number;
}

/**
 * Where one frozen pack version stands. Only sign-offs on THAT pack count: a
 * sign-off on an earlier version never carries over to a later one.
 */
export function packSignOff(packId: string, approvals: readonly DecisionApprovalRow[]): PackSignOff {
  const own = approvals.filter((a) => a.pack_id === packId);
  const ok = own.filter((a) => a.verdict === 'approve').length;
  const no = own.length - ok;
  return { state: no > 0 ? 'declined' : ok > 0 ? 'approved' : 'none', approvals: ok, declines: no };
}

/**
 * One plain line for the pack heading. It reports what was recorded, never
 * "approved" outright: no capacity is required, so one approval is a record,
 * not an authorisation (Simon, 2026-11-19: never imply completion because one
 * reviewer finished).
 */
export function packSignOffSummary(signOff: PackSignOff): string {
  const approvals = `${String(signOff.approvals)} ${signOff.approvals === 1 ? 'approval' : 'approvals'} recorded`;
  if (signOff.state === 'none') return 'not signed yet';
  if (signOff.state === 'declined') return `declined by ${String(signOff.declines)}${signOff.approvals > 0 ? `, ${approvals}` : ''}`;
  return approvals;
}

/** The lenses a person has not yet signed this pack as, so the form offers only what is still open to them. */
export function lensesOpenTo(userId: string | null, packId: string, approvals: readonly DecisionApprovalRow[], all: readonly DecisionApprovalLens[]): DecisionApprovalLens[] {
  const taken = new Set(approvals.filter((a) => a.pack_id === packId && a.decided_by === userId).map((a) => a.lens));
  return all.filter((l) => !taken.has(l));
}

/** True when the live write-up no longer matches the latest frozen pack, so the pack (and any sign-off on it) is out of date. */
export function packIsStale(latestBody: string | undefined, liveMarkdown: string): boolean {
  return latestBody !== undefined && latestBody.trim() !== liveMarkdown.trim();
}

export interface LensProgress {
  lens: DecisionApprovalLens;
  /** approved: at least one approve and no decline; declined: any decline; none: nobody has signed as this capacity yet. */
  state: 'approved' | 'declined' | 'none';
}

/**
 * The per-capacity view of one pack version: review progress, not a sign-off
 * rule (no capacity is required; Simon chose labels over required lenses).
 * Only sign-offs on THAT pack count.
 */
export function lensProgress(packId: string, approvals: readonly DecisionApprovalRow[], all: readonly DecisionApprovalLens[]): LensProgress[] {
  return all.map((lens) => {
    const own = approvals.filter((a) => a.pack_id === packId && a.lens === lens);
    const state = own.some((a) => a.verdict === 'decline') ? 'declined' : own.length > 0 ? 'approved' : 'none';
    return { lens, state };
  });
}
