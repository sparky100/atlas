/**
 * F13 step 2: the project pack — one document a project can be handed over
 * with: purpose, scope, the decision log (each decision through the same
 * ADR builder "Copy as ADR markdown" uses), a target-state summary per
 * change, and the evidence. A rendering of what the project page already
 * shows, never stored state.
 *
 * This file is the pure half — data in, Markdown out, unit-testable with
 * no I/O. `loadProjectPack.ts` gathers the data; `markdownPdf.ts` turns the
 * same Markdown into a PDF, so the two formats can never disagree.
 */
import type { ChangeListSummary } from '../../db/changeSummary';
import type { BranchRow, DecisionRow, EvidenceRow, ProjectRow } from '../../db/types';
import { intentHeaderLine } from '../changes/branchIntent';
import { describeDelta } from '../changes/changeSummaryFormat';
import { projectChangeStage, projectChangeStageLabel, projectProgress, projectStatusLabel } from '../projects/projectModel';

export interface ProjectPackScopeItem {
  name: string;
  typeLabel: string;
}

export interface ProjectPackDecision {
  decision: DecisionRow;
  /** `exportDecisionAsAdrMarkdown`'s own output for this decision, unchanged — the pack only shifts its headings down to nest under "Decision log". */
  adrMarkdown: string;
}

export interface ProjectPackChange {
  branch: BranchRow;
  /** `null` when the change's history couldn't be read (the change list's own "one bad row degrades one card" stance) — said so in the pack, never left blank. */
  summary: ChangeListSummary | null;
}

export interface ProjectPackInput {
  modelName: string;
  /** `YYYY-MM-DD` — passed in, so the builder stays pure. */
  date: string;
  project: ProjectRow;
  ownerName: string;
  scope: readonly ProjectPackScopeItem[];
  /** Names of elements the project's changes touch that aren't in the declared scope (ADR-024 §5). */
  touchedNotDeclared: readonly string[];
  /** Names of declared-scope elements no change touches yet. */
  declaredNotTouched: readonly string[];
  /** The project's own decisions, oldest first. */
  decisions: readonly ProjectPackDecision[];
  constrainingDecisions: readonly DecisionRow[];
  changes: readonly ProjectPackChange[];
  evidence: readonly EvidenceRow[];
}

/** Every Markdown heading in `markdown` pushed down `levels` (capped at h6), so an ADR's own `#` nests under the pack's sections. */
export function demoteHeadings(markdown: string, levels: number): string {
  return markdown
    .split('\n')
    .map((line) => {
      const match = /^(#{1,6}) /.exec(line);
      if (!match?.[1]) return line;
      const depth = Math.min(6, match[1].length + levels);
      return `${'#'.repeat(depth)} ${line.slice(match[1].length + 1)}`;
    })
    .join('\n');
}

const EVIDENCE_KIND_LABEL: Record<string, string> = { link: 'Link', document: 'Document', capture_job_ref: 'Capture', comment_ref: 'Comment' };

function evidenceLine(e: EvidenceRow): string {
  const label = EVIDENCE_KIND_LABEL[e.kind] ?? e.kind;
  const pointer = /^https?:\/\//i.test(e.pointer) ? `<${e.pointer}>` : e.pointer;
  return `- ${label}: ${pointer}${e.description ? ` — ${e.description}` : ''} (added ${e.added_at.slice(0, 10)})`;
}

function changeLines(change: ProjectPackChange): string[] {
  const { branch, summary } = change;
  const lines: string[] = [];
  lines.push(`### ${intentHeaderLine(branch)}`);
  lines.push('');
  const meta = [`**Stage:** ${projectChangeStageLabel(projectChangeStage(branch))}`, `**Status:** ${branch.status}`];
  if (branch.target_date) meta.push(`**Target date:** ${branch.target_date}`);
  lines.push(meta.join(' · '));
  lines.push('');
  if (summary === null) {
    lines.push("This change's history couldn't be read, so its target state isn't summarised here. Open it in Atlas.");
    return lines;
  }
  if (summary.subjects.length === 0) {
    lines.push('No edits yet — this change matches main.');
    return lines;
  }
  lines.push(summary.description);
  if (summary.affectedCapabilities.length > 0) {
    lines.push('');
    lines.push('**Capabilities affected:**');
    lines.push('');
    for (const ac of summary.affectedCapabilities) {
      const via = ac.viaSystems.length > 0 ? ` (via ${ac.viaSystems.map((s) => s.name).join(', ')})` : '';
      lines.push(`- ${ac.capability.name}${via}`);
    }
  }
  lines.push('');
  lines.push('**What it changes:**');
  lines.push('');
  for (const subject of summary.subjects) lines.push(`- **${subject.name}** — ${subject.deltas.map(describeDelta).join('; ')}`);
  return lines;
}

/**
 * Every section is present, saying plainly when it's empty (rule 7: absent,
 * not faked) — a reader of a handed-over pack can't open the project to
 * check whether "no decisions" meant none or a missing export.
 */
export function buildProjectPackMarkdown(input: ProjectPackInput): string {
  const { modelName, date, project, ownerName, scope, touchedNotDeclared, declaredNotTouched, decisions, constrainingDecisions, changes, evidence } = input;
  const progress = projectProgress(
    changes.map((c) => c.branch),
    decisions.map((d) => d.decision),
  );
  const lines: string[] = [];
  lines.push(`# Project pack: ${project.title}`);
  lines.push('');
  lines.push(`${modelName} · exported ${date} from Atlas`);
  lines.push('');
  lines.push(`**Status:** ${projectStatusLabel(project.status)}`);
  lines.push(`**Owner:** ${ownerName}`);
  if (project.start_date) lines.push(`**Start:** ${project.start_date}`);
  if (project.target_date) lines.push(`**Target:** ${project.target_date}`);
  if ((project.status === 'closed' || project.status === 'cancelled') && project.closed_at) {
    lines.push(`**${project.status === 'closed' ? 'Closed' : 'Cancelled'}:** ${project.closed_at.slice(0, 10)}${project.close_reason ? ` — ${project.close_reason}` : ''}`);
  }
  lines.push(
    `**Progress:** ${String(progress.openChanges)} open ${progress.openChanges === 1 ? 'change' : 'changes'} · ${String(progress.mergedChanges)} merged · ${String(progress.openDecisions)} open ${progress.openDecisions === 1 ? 'decision' : 'decisions'} · ${String(progress.decidedDecisions)} decided`,
  );

  lines.push('');
  lines.push('## Purpose');
  lines.push('');
  lines.push(project.purpose.trim().length > 0 ? project.purpose : 'No purpose recorded.');

  lines.push('');
  lines.push('## Scope');
  lines.push('');
  if (scope.length === 0) lines.push('No scope declared.');
  for (const item of scope) lines.push(`- ${item.name} (${item.typeLabel})`);
  if (touchedNotDeclared.length > 0) {
    lines.push('');
    lines.push(`**Touched by the project's changes but not in the declared scope:** ${touchedNotDeclared.join(', ')}`);
  }
  if (declaredNotTouched.length > 0) {
    lines.push('');
    lines.push(`**In the declared scope but not touched by any change yet:** ${declaredNotTouched.join(', ')}`);
  }

  lines.push('');
  lines.push('## Decision log');
  lines.push('');
  if (decisions.length === 0) lines.push('No decisions in this project.');
  decisions.forEach((d, i) => {
    if (i > 0) lines.push('');
    lines.push(demoteHeadings(d.adrMarkdown.trimEnd(), 2));
  });
  if (constrainingDecisions.length > 0) {
    lines.push('');
    lines.push('### Decisions that constrain this project');
    lines.push('');
    for (const d of constrainingDecisions) lines.push(`- ${d.title} (${d.status}${d.decided_at ? `, decided ${d.decided_at.slice(0, 10)}` : ''})`);
  }

  lines.push('');
  lines.push('## Target state by change');
  lines.push('');
  if (changes.length === 0) lines.push('No changes in this project.');
  changes.forEach((c, i) => {
    if (i > 0) lines.push('');
    lines.push(...changeLines(c));
  });

  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  if (evidence.length === 0) lines.push('No evidence attached.');
  for (const e of evidence) lines.push(evidenceLine(e));

  return `${lines.join('\n')}\n`;
}

/** `{model}-{project}-pack-{date}.{ext}`, safe on every OS — the same shape as the view exports' filenames. */
export function projectPackFilename(modelName: string, projectTitle: string, date: string, ext: 'md' | 'pdf'): string {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';
  return `${safe(modelName)}-${safe(projectTitle)}-pack-${date}.${ext}`;
}

