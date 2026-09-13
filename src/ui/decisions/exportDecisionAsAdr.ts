import type { BranchRow, DecisionRow } from '../../db/types';
import { intentHeaderLine } from '../changes/branchIntent';

/**
 * Prompt pack F3 PR6's "Export as ADR markdown" — genuinely new from
 * scratch (no markdown-generation precedent exists anywhere in `src/`,
 * confirmed by grep before writing this), following
 * `src/db/exportCapabilityMap.ts`'s own "read the model, walk it, produce
 * output" shape — the pure builder here, writing text instead of JSON, is
 * unit-testable on its own the same way `buildCapabilityMapExport` is,
 * with no Supabase round trip inside it. `DecisionView.tsx`'s "Copy as ADR
 * markdown" action (mirroring `ElementHeader.tsx`'s own "Copy element ID"
 * clipboard pattern — no download mechanism exists anywhere in this app to
 * invent one for) assembles this input from data the decision page has
 * already loaded, and copies the string this function returns.
 */
export interface DecisionAdrExportOption {
  branch: BranchRow;
  isChosen: boolean;
}

export interface DecisionAdrExportInput {
  decision: DecisionRow;
  ownerName: string;
  options: readonly DecisionAdrExportOption[];
  /** The one `decision_arguments` row `atlas.choose_decision_option` writes (`stance: 'for'`) — `null` until the decision is `accepted`. */
  reasons: string | null;
}

function statusLine(decision: DecisionRow): string {
  const label = decision.status.charAt(0).toUpperCase() + decision.status.slice(1);
  return decision.decided_at ? `${label} — decided ${decision.decided_at}` : label;
}

function optionLine(option: DecisionAdrExportOption): string {
  const label = intentHeaderLine(option.branch);
  if (option.isChosen) return `- **${label}** — chosen`;
  if (option.branch.status === 'cancelled') return `- ${label} — not chosen`;
  return `- ${label} — ${option.branch.status}`;
}

/**
 * Every section renders only what the decision actually has (CLAUDE.md
 * rule 7: absent, not faked) — "Options considered" is omitted entirely
 * when nothing has been linked yet, and "Decision" reads "Not yet decided"
 * rather than inventing a reasons paragraph for a still-`proposed` decision.
 */
export function exportDecisionAsAdrMarkdown(input: DecisionAdrExportInput): string {
  const { decision, ownerName, options, reasons } = input;
  const lines: string[] = [];
  lines.push(`# ADR: ${decision.title}`);
  lines.push('');
  lines.push(`**Status:** ${statusLine(decision)}`);
  lines.push(`**Owner:** ${ownerName}`);
  if (decision.needed_by) lines.push(`**Needed by:** ${decision.needed_by}`);
  if (decision.lens_map_url) lines.push(`**Lens map:** ${decision.lens_map_url}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(decision.statement.trim().length > 0 ? decision.statement : 'No context recorded.');

  if (options.length > 0) {
    lines.push('');
    lines.push('## Options considered');
    lines.push('');
    for (const option of options) lines.push(optionLine(option));
  }

  lines.push('');
  lines.push('## Decision');
  lines.push('');
  if (decision.status === 'accepted') {
    const chosen = options.find((o) => o.isChosen);
    const chosenLabel = chosen ? intentHeaderLine(chosen.branch) : 'the chosen option';
    lines.push(`We will ${chosenLabel}.`);
    if (reasons && reasons.trim().length > 0) {
      lines.push('');
      lines.push(reasons);
    }
  } else {
    lines.push('Not yet decided.');
  }

  return `${lines.join('\n')}\n`;
}
