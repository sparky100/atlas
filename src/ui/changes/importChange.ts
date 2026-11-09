import type { BranchRow } from '../../db/types';

/** The change's title or name starts "Import: " when the importer made it (`useCaptureReviewQueue`'s auto-created change). */
export function isImportChange(branch: Pick<BranchRow, 'title' | 'name'>): boolean {
  return (branch.title ?? branch.name).startsWith('Import: ');
}
