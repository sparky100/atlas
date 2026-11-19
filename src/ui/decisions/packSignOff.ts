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

/** One plain line for the pack heading. */
export function packSignOffSummary(signOff: PackSignOff): string {
  if (signOff.state === 'none') return 'not signed yet';
  if (signOff.state === 'declined') return `declined by ${String(signOff.declines)}${signOff.approvals > 0 ? `, approved by ${String(signOff.approvals)}` : ''}`;
  return `approved by ${String(signOff.approvals)}`;
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
