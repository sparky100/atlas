import { OPTION_APPROACH_LABELS, type OptionApproach } from '../../contracts/optionApproach';
import type { DecisionAgentNote } from '../../contracts/decisionAgentNote';
import type { OptionSource } from '../../contracts/optionSource';
import type { UUID } from '../../contracts/delta';
import { aiMarkLine } from './aiMarks';
import type { BranchRow, DecisionRow } from '../../db/types';
import { intentHeaderLine } from './intentHeaderLine';
import { decisionStatusLabel } from './decisionStatusLabel';
import type { WhatChangesRow } from './whatChangesType';

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
  /** The candidate's stable id (`decision_options.id`); absent only in older test/legacy callers. */
  optionId?: UUID;
  /** The candidate's own title, used when it has no delivery change. */
  title?: string;
  /** What the person wrote about the candidate, used when it has no delivery change. */
  about?: string;
  /** The delivery change, when one exists; null for an untouched candidate. */
  branch: BranchRow | null;
  /** What kind of option this is (Keep, Configure, Buy, Build, No change); absent or null prints no label, so an older pack reads as it did. */
  approach?: OptionApproach | null;
  /** Candidate while no delivery change exists; otherwise the branch's own status. */
  status?: BranchRow['status'] | 'candidate';
  isChosen: boolean;
  /** This option's own recorded ratings, already resolved to the criterion's/level's own display label (`decisionCriterionLevelLabel`) and in `DECISION_CRITERIA`'s own presentation order - the same labels and order the criteria grid itself shows, never a raw criterion/level key. Empty when nothing on this option has been rated yet. */
  ratings: readonly DecisionAdrExportOptionRating[];
  /** Catalogue or web evidence saved with this option. Optional/empty prints no Sources block, so an older pack reads as it did. */
  sources?: readonly OptionSource[];
}

export interface DecisionAdrExportInput {
  decision: DecisionRow;
  ownerName: string;
  /** The review digest omits personal identity; the pack always uses the default. */
  omitOwner?: boolean;
  /** The decision's own declared concerns (linked capabilities/systems/containers) — empty when none are linked yet. */
  concerns: readonly DecisionAdrExportConcern[];
  options: readonly DecisionAdrExportOption[];
  /** Only the rows the What-changes table itself renders as visible (`groupWhatChangesRows(comparison.whatChangesRows).visible`) — never the collapsed "N rows unchanged in all options" group, matching the brief's own "only differing rows". Empty when nothing differs (or no options are linked yet). */
  whatChangesRows: readonly WhatChangesRow[];
  /** ADR-034: the principles this decision follows or departs from, follows first. Optional: absent or empty prints no section. */
  principles?: readonly { title: string; stance: 'follows' | 'departs'; reason: string }[];
  /** Titles of the active goals that the capabilities this decision concerns serve. Optional: absent or empty prints no section. */
  goalsServed?: readonly string[];
  /** The one `decision_arguments` row `atlas.choose_decision_option` writes (`stance: 'for'`) — `null` until the decision is `accepted`. */
  reasons: string | null;
  /** D2 PR 4: questions an AI reviewer drafted that a person kept. Optional/empty prints no section. */
  keptQuestions?: readonly DecisionAgentNote[];
}

function statusLine(decision: DecisionRow): string {
  const shown = decisionStatusLabel(decision.status);
  const label = shown.charAt(0).toUpperCase() + shown.slice(1);
  if (decision.status === 'rejected') return decision.decided_at ? `${label} — ${decision.decided_at.slice(0, 10)}` : label;
  // The date only — `decided_at` is a full timestamp, which reads as noise in a document.
  return decision.decided_at ? `${label} — decided ${decision.decided_at.slice(0, 10)}` : label;
}

function optionTitle(option: DecisionAdrExportOption): string {
  return option.title ?? (option.branch === null ? 'Untitled candidate' : (option.branch.title ?? option.branch.name));
}

/** The outcome in one plain line, so a reader meets it before the detail. */
function outcomeLine(decision: DecisionRow, options: readonly DecisionAdrExportOption[]): string {
  if (decision.status === 'accepted') {
    const chosen = options.find((o) => o.isChosen);
    return chosen ? `Chose ${optionTitle(chosen)}` : 'An option was chosen, but it is no longer linked to this decision';
  }
  if (decision.status === 'rejected') return 'Cancelled without choosing an option';
  return 'Not yet decided';
}

/** What the option is, in one line, when someone wrote it down (a Designer suggestion the person kept, or their own words). */
function optionAboutLines(option: DecisionAdrExportOption): string[] {
  const about = (option.about ?? option.branch?.description ?? '').replace(/\s+/g, ' ').trim();
  return about === '' ? [] : [`  - About: ${about}`];
}

function optionLine(option: DecisionAdrExportOption): string {
  const name = option.branch === null ? (option.title ?? 'Untitled candidate') : intentHeaderLine(option.branch);
  const label = option.approach != null ? `(${OPTION_APPROACH_LABELS[option.approach]}) ${name}` : name;
  if (option.isChosen) return `- **${label}** — chosen`;
  if (option.status === 'cancelled' || option.branch?.status === 'cancelled') return `- ${label} — not chosen`;
  if (option.branch === null || option.status === 'candidate') return `- ${label} — candidate`;
  return `- ${label} — ${option.status ?? option.branch.status}`;
}

/** One indented sub-bullet per rating, in the order the caller supplied (`DECISION_CRITERIA`'s own presentation order) — no ratings at all renders nothing, not an empty "no ratings" line, matching this file's own "only render what the decision actually has" rule. */
function optionRatingLines(option: DecisionAdrExportOption): string[] {
  return option.ratings.map((r) => `  - ${r.criterionLabel}: ${r.levelLabel}${r.note && r.note.trim().length > 0 ? ` — ${r.note}` : ''}`);
}

/** Saved evidence, under the option it belongs to. The product and the claim are both printed: a reader should not have to open a URL to know what was claimed. */
function optionSourceLines(option: DecisionAdrExportOption): string[] {
  const sources = option.sources ?? [];
  if (sources.length === 0) return [];
  const lines = ['  - Sources:'];
  for (const source of sources) {
    if (source.kind === 'web') {
      const checkedAt = source.checkedAt;
      const checked = source.assertion !== null && checkedAt !== null;
      const check = checked ? `checked by a person on ${checkedAt.slice(0, 10)}` : 'unreviewed';
      lines.push(`    - ${source.title} - ${source.url} (${source.publisher ?? 'web page'}; retrieved ${source.retrievedAt.slice(0, 10)}; ${check})`);
      if (source.excerpt !== null) lines.push(`      - ${source.excerpt}`);
      if (source.assertion !== null) lines.push(`      - Supports: ${source.assertion}`);
      continue;
    }
    const standing = source.standing === 'current'
      ? `current in catalogue v${String(source.version)}`
      : source.standing === 'replaced'
        ? `saved from catalogue v${String(source.version)}, since replaced`
        : `saved from catalogue v${String(source.version)}, now withdrawn`;
    lines.push(`    - ${source.product} - ${source.vendor} (${standing})`);
    for (const claim of source.claims) {
      lines.push(`      - ${claim.statement} - ${claim.sourceUrl} (source dated ${claim.sourceDate})`);
    }
  }
  return lines;
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
  const goalsServed = input.goalsServed ?? [];
  const lines: string[] = [];
  lines.push(`# ADR: ${decision.title}`);
  lines.push('');
  lines.push(`**Status:** ${statusLine(decision)}`);
  lines.push(`**Result:** ${outcomeLine(decision, options)}`);
  if (!input.omitOwner) lines.push(`**Owner:** ${ownerName}`);
  if (decision.needed_by) lines.push(`**Needed by:** ${decision.needed_by}`);
  if (decision.lens_map_url) lines.push(`**Lens map:** ${decision.lens_map_url}`);
  lines.push('');
  // The pack leads with the outcome the business wants (item 3).
  lines.push('## Outcome we want');
  lines.push('');
  lines.push(decision.outcome.trim().length > 0 ? decision.outcome.trim() : decision.status === 'proposed' ? 'No outcome recorded yet.' : 'No outcome was recorded for this decision.');
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(decision.statement.trim().length > 0 ? decision.statement : 'No context recorded.');
  const aiLine = aiMarkLine(decision);
  if (aiLine !== null) {
    lines.push('');
    lines.push(`*${aiLine}*`);
  }

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
      lines.push(...optionAboutLines(option));
      lines.push(...optionRatingLines(option));
      lines.push(...optionSourceLines(option));
    }
  }

  const keptQuestions = input.keptQuestions ?? [];
  if (keptQuestions.length > 0) {
    lines.push('');
    lines.push('## Questions raised by an AI reviewer');
    lines.push('');
    for (const note of keptQuestions) {
      const lens = note.lens === 'challenge' ? 'Challenger' : note.lens === 'cyber' ? 'Steward: cyber' : 'Steward: data';
      const based = note.basedOn !== 'none' && note.basedOnLabel !== null ? ` (based on ${note.basedOnLabel})` : '';
      lines.push(`- **${lens}**, kept ${note.keptAt.slice(0, 10)}${based}: ${note.question}`);
      if (note.suggestedQuestion !== note.question) lines.push(`  - Original AI wording: ${note.suggestedQuestion}`);
    }
    lines.push('');
    lines.push('These are questions a person kept, not a review, clearance or sign-off.');
  }

  const stayRisk = decision.stay_risk.trim();
  const stayReason = decision.stay_reason.trim();
  if (stayRisk.length > 0 || stayReason.length > 0) {
    lines.push('');
    lines.push('## Staying as we are');
    lines.push('');
    if (stayRisk.length > 0) lines.push(`Risk of staying: ${stayRisk}`);
    if (stayReason.length > 0) lines.push(`Why we cannot or will not change: ${stayReason}`);
  }

  if (whatChangesRows.length > 0) {
    lines.push('');
    lines.push('## What changes (evidence)');
    lines.push('');
    const optionLabelsByBranchId = new Map(options.flatMap((o) => (o.branch === null ? [] : [[o.branch.id, intentHeaderLine(o.branch)] as const])));
    for (const row of whatChangesRows) lines.push(whatChangesRowLine(row, optionLabelsByBranchId));
  }

  if (principles.length > 0) {
    lines.push('');
    lines.push('## Principles');
    lines.push('');
    for (const p of principles) lines.push(p.stance === 'departs' ? `- Departs from **${p.title}** — ${p.reason}` : `- Follows **${p.title}**`);
  }

  if (goalsServed.length > 0) {
    lines.push('');
    lines.push('## Goals served');
    lines.push('');
    for (const g of goalsServed) lines.push(`- ${g}`);
  }

  lines.push('');
  lines.push('## Decision');
  lines.push('');
  if (decision.status === 'accepted') {
    const chosen = options.find((o) => o.isChosen);
    // The option by its own title — not `intentHeaderLine`, whose "Proposing: …" prefix made "We will Proposing: X" read wrongly.
    lines.push(chosen ? `Chosen option: **${optionTitle(chosen)}**.` : 'An option was chosen, but it is no longer linked to this decision.');
    if (reasons && reasons.trim().length > 0) {
      lines.push('');
      lines.push(reasons);
    }
    if (decision.reconsider_if && decision.reconsider_if.trim().length > 0) {
      lines.push('');
      lines.push(`Reconsider if: ${decision.reconsider_if}${decision.review_by ? ` (look again by ${decision.review_by})` : ''}`);
    } else if (decision.review_by) {
      lines.push('');
      lines.push(`Look again by ${decision.review_by}.`);
    }
  } else if (decision.status === 'rejected') {
    lines.push(decision.cancel_reason ? `Cancelled without choosing an option: ${decision.cancel_reason}` : 'Cancelled without choosing an option.');
  } else {
    lines.push('Not yet decided.');
  }

  return `${lines.join('\n')}\n`;
}
