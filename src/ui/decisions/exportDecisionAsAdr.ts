import type { UUID } from '../../contracts/delta';
import type { BranchRow, DecisionRow } from '../../db/types';
import { intentHeaderLine } from '../changes/branchIntent';
import { decisionStatusLabel } from './decisionStatus';
import type { WhatChangesRow } from './whatChangesRows';

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
 *
 * Decision-side-completion item 6: the export was missing three of the
 * things the brief names — the decision's own declared concerns, each
 * option's own recorded judgement-criteria ratings and notes, and the
 * "What changes" table's own evidence. All three are added below as
 * plain, pre-resolved data the caller assembles from what it has already
 * loaded (`DecisionView.tsx`'s own `concernedCapabilityIds`/
 * `otherConcernElementIds`/`linkedElementsById`, `useDecisionRatings.ts`'s
 * `ratings`, and `comparison.whatChangesRows` filtered to
 * `groupWhatChangesRows(...).visible` — "only differing rows", the
 * brief's own words, never the collapsed "N rows unchanged" group) —
 * this stays a pure string builder with no fetch or fold of its own.
 */
export interface DecisionAdrExportConcern {
  name: string;
  /** `element_type` ('capability' | 'system' | 'container') — shown alongside the name so a reader can tell a capability concern from a system/container one without opening the model. */
  typeLabel: string;
}

export interface DecisionAdrExportOptionRating {
  criterionLabel: string;
  levelLabel: string;
  note: string | null;
}

export interface DecisionAdrExportOption {
  branch: BranchRow;
  isChosen: boolean;
  /** This option's own recorded ratings, already resolved to the criterion's/level's own display label (`decisionCriterionLevelLabel`) and in `DECISION_CRITERIA`'s own presentation order — the same labels and order the criteria grid itself shows, never a raw criterion/level key. Empty when nothing on this option has been rated yet. */
  ratings: readonly DecisionAdrExportOptionRating[];
}

export interface DecisionAdrExportInput {
  decision: DecisionRow;
  ownerName: string;
  /** The decision's own declared concerns (linked capabilities/systems/containers) — empty when none are linked yet. */
  concerns: readonly DecisionAdrExportConcern[];
  options: readonly DecisionAdrExportOption[];
  /** Only the rows the What-changes table itself renders as visible (`groupWhatChangesRows(comparison.whatChangesRows).visible`) — never the collapsed "N rows unchanged in all options" group, matching the brief's own "only differing rows". Empty when nothing differs (or no options are linked yet). */
  whatChangesRows: readonly WhatChangesRow[];
  /** ADR-034: the principles this decision follows or departs from, follows first. Optional: absent or empty prints no section. */
  principles?: readonly { title: string; stance: 'follows' | 'departs'; reason: string }[];
  /** The one `decision_arguments` row `atlas.choose_decision_option` writes (`stance: 'for'`) — `null` until the decision is `accepted`. */
  reasons: string | null;
}

function statusLine(decision: DecisionRow): string {
  const shown = decisionStatusLabel(decision.status);
  const label = shown.charAt(0).toUpperCase() + shown.slice(1);
  if (decision.status === 'rejected') return decision.decided_at ? `${label} — ${decision.decided_at.slice(0, 10)}` : label;
  // The date only — `decided_at` is a full timestamp, which reads as noise in a document.
  return decision.decided_at ? `${label} — decided ${decision.decided_at.slice(0, 10)}` : label;
}

function optionLine(option: DecisionAdrExportOption): string {
  const label = intentHeaderLine(option.branch);
  if (option.isChosen) return `- **${label}** — chosen`;
  if (option.branch.status === 'cancelled') return `- ${label} — not chosen`;
  return `- ${label} — ${option.branch.status}`;
}

/** One indented sub-bullet per rating, in the order the caller supplied (`DECISION_CRITERIA`'s own presentation order) — no ratings at all renders nothing, not an empty "no ratings" line, matching this file's own "only render what the decision actually has" rule. */
function optionRatingLines(option: DecisionAdrExportOption): string[] {
  return option.ratings.map((r) => `  - ${r.criterionLabel}: ${r.levelLabel}${r.note && r.note.trim().length > 0 ? ` — ${r.note}` : ''}`);
}

function whatChangesRowLine(row: WhatChangesRow, optionLabelsByBranchId: ReadonlyMap<UUID, string>): string {
  const optionParts = [...row.options.entries()].map(([branchId, cell]) => `${optionLabelsByBranchId.get(branchId) ?? branchId}: ${cell.display}`);
  return `- **${row.groupLabel} — ${row.rowLabel}** — ${[`Current (main): ${row.main.display}`, ...optionParts].join('; ')}`;
}

/**
 * Every section renders only what the decision actually has (CLAUDE.md
 * rule 7: absent, not faked) — "Options considered" is omitted entirely
 * when nothing has been linked yet, and "Decision" reads "Not yet decided"
 * rather than inventing a reasons paragraph for a still-`proposed` decision.
 */
export function exportDecisionAsAdrMarkdown(input: DecisionAdrExportInput): string {
  const { decision, ownerName, concerns, options, whatChangesRows, reasons } = input;
  const principles = input.principles ?? [];
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

  if (concerns.length > 0) {
    lines.push('');
    lines.push('## Concerns');
    lines.push('');
    for (const concern of concerns) lines.push(`- ${concern.name} (${concern.typeLabel})`);
  }

  if (options.length > 0) {
    lines.push('');
    lines.push('## Options considered');
    lines.push('');
    for (const option of options) {
      lines.push(optionLine(option));
      lines.push(...optionRatingLines(option));
    }
  }

  if (whatChangesRows.length > 0) {
    lines.push('');
    lines.push('## What changes (evidence)');
    lines.push('');
    const optionLabelsByBranchId = new Map(options.map((o) => [o.branch.id, intentHeaderLine(o.branch)]));
    for (const row of whatChangesRows) lines.push(whatChangesRowLine(row, optionLabelsByBranchId));
  }

  if (principles.length > 0) {
    lines.push('');
    lines.push('## Principles');
    lines.push('');
    for (const p of principles) lines.push(p.stance === 'departs' ? `- Departs from **${p.title}** — ${p.reason}` : `- Follows **${p.title}**`);
  }

  lines.push('');
  lines.push('## Decision');
  lines.push('');
  if (decision.status === 'accepted') {
    const chosen = options.find((o) => o.isChosen);
    // The option by its own title — not `intentHeaderLine`, whose "Proposing: …" prefix made "We will Proposing: X" read wrongly.
    lines.push(chosen ? `Chosen option: **${chosen.branch.title ?? chosen.branch.name}**.` : 'An option was chosen, but it is no longer linked to this decision.');
    if (reasons && reasons.trim().length > 0) {
      lines.push('');
      lines.push(reasons);
    }
  } else if (decision.status === 'rejected') {
    lines.push(decision.cancel_reason ? `Cancelled without choosing an option: ${decision.cancel_reason}` : 'Cancelled without choosing an option.');
  } else {
    lines.push('Not yet decided.');
  }

  return `${lines.join('\n')}\n`;
}
