import type { BranchRow } from '../../db/types';

/** Shared wording for an option in the page, pack and reviewer digest. */
export function intentHeaderLine(branch: Pick<BranchRow, 'intent' | 'title' | 'name'>): string {
  const title = branch.title ?? branch.name;
  switch (branch.intent) {
    case 'record': return `Recording: ${title}`;
    case 'propose': return `Proposing: ${title}`;
    case 'correct': return 'Correction';
    case 'explore': return `Exploring: ${title}`;
    case null: return title;
  }
}
