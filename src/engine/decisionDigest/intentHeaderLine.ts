/**
 * F0's own four header sentences, verbatim shape from the prompt pack:
 * "Recording: Dynamics went live 3 Sept" / "Proposing: replace ADQM by
 * March" / "Correction" / "Exploring: option B for Customer Contact" —
 * `correct` is deliberately the one intent with no title suffix.
 *
 * Server-safe copy of `src/ui/changes/branchIntent.ts`'s `intentHeaderLine`
 * (that file re-exports this one), so the ADR formatter and reviewer digest
 * never import UI code. Keep the two in step.
 */
import type { BranchRow } from '../../db/types';

export function intentHeaderLine(branch: Pick<BranchRow, 'intent' | 'title' | 'name'>): string {
  const title = branch.title ?? branch.name;
  switch (branch.intent) {
    case 'record':
      return `Recording: ${title}`;
    case 'propose':
      return `Proposing: ${title}`;
    case 'correct':
      return 'Correction';
    case 'explore':
      return `Exploring: ${title}`;
    case null:
      return title;
  }
}
