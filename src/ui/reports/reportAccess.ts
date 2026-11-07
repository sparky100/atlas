/**
 * ADR-027: who may edit a saved report — its creator, or an organisation
 * owner or architect for a report shared with the organisation. RLS is the
 * real check (`saved_reports_update`); this mirrors it so nobody is offered
 * a button the database would refuse.
 */
import type { UUID } from '../../contracts/delta';
import type { MemberRole, SavedReportRow } from '../../db/types';

export function canEditReport(report: Pick<SavedReportRow, 'created_by' | 'visibility'>, userId: UUID | null, role: MemberRole | null): boolean {
  if (userId === null) return false;
  if (report.created_by === userId) return true;
  return report.visibility === 'organisation' && (role === 'owner' || role === 'architect');
}

/** Only an owner or architect may publish to, or withdraw from, the organisation (ADR-027 visibility rules). */
export function canShareReport(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect';
}
