import type { UUID } from '../../contracts/delta';
import type { CaptureJob } from '../../contracts/capture';

export interface DuplicateDraftGroup {
  inputName: string;
  /** The most recently created draft of this file — the one kept. */
  newestId: UUID;
  /** Every other draft of the same file, newest first — what "Discard older copies" discards. */
  olderIds: UUID[];
}

/**
 * The review queue's "Discard older copies": capture drafts awaiting
 * review that share an `inputName` (the same file uploaded and run more
 * than once), grouped so all but the newest can be discarded in one
 * action. Only names with more than one draft are returned, in the order
 * their newest draft was created (newest first). `jobs` is expected to be
 * the already-filtered set the caller may act on.
 */
export function olderDuplicateDrafts(jobs: readonly Pick<CaptureJob, 'id' | 'inputName' | 'createdAt'>[]): DuplicateDraftGroup[] {
  const byName = new Map<string, Pick<CaptureJob, 'id' | 'inputName' | 'createdAt'>[]>();
  for (const job of jobs) {
    const list = byName.get(job.inputName) ?? [];
    list.push(job);
    byName.set(job.inputName, list);
  }
  const groups: { group: DuplicateDraftGroup; newestAt: string }[] = [];
  for (const [inputName, list] of byName) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt)));
    const [newest, ...older] = sorted;
    if (!newest) continue;
    groups.push({ group: { inputName, newestId: newest.id, olderIds: older.map((j) => j.id) }, newestAt: newest.createdAt });
  }
  groups.sort((a, b) => b.newestAt.localeCompare(a.newestAt));
  return groups.map((g) => g.group);
}
