/**
 * Importing goals (ADR-035). Pure: reads the rows of a goals sheet, checks them
 * with the same limits the Goals form uses, and plans what applying them would
 * do. Goals are not facts and have no review step, so this is not the capture
 * importer: an owner or architect sees the plan and applies it directly, and
 * the database (RLS and triggers) is still the real gate.
 *
 * Applying only ever adds. A title that already exists (active or retired,
 * any capitalisation) is skipped, never overwritten, so running a file twice
 * adds nothing the second time.
 */
import { checkGoalInput, type GoalInput, type GoalInputProblem } from '../../contracts/goals';

/** The most goals one file may add, so a wrong file cannot flood a model. */
export const GOALS_IMPORT_MAX_ROWS = 200;

export const GOALS_SHEET_HEADINGS = ['Title', 'What success looks like', 'Why now', 'Capabilities'] as const;

type GoalColumn = 'title' | 'statement' | 'whyNow' | 'capabilities';

const COLUMN_SYNONYMS: Record<GoalColumn, readonly string[]> = {
  title: ['title', 'goal', 'goal title', 'name'],
  statement: ['what success looks like', 'success', 'statement', 'description'],
  whyNow: ['why now', 'driver', 'reason'],
  capabilities: ['capabilities', 'capability', 'serves', 'served by'],
};

function normaliseHeading(cell: string): string {
  return cell.trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

function columnFor(cell: string): GoalColumn | null {
  const heading = normaliseHeading(cell);
  for (const column of Object.keys(COLUMN_SYNONYMS) as GoalColumn[]) {
    if (COLUMN_SYNONYMS[column].includes(heading)) return column;
  }
  return null;
}

export interface ParsedGoalRow {
  /** The row's number in the sheet, as a person counts it (the heading row is 1). */
  rowNumber: number;
  title: string;
  statement: string;
  whyNow: string;
  capabilityNames: string[];
}

export type ParseGoalsResult = { ok: true; rows: ParsedGoalRow[] } | { ok: false; reason: 'no-heading' | 'no-rows' | 'too-many'; max?: number };

/** Names are split on semicolons and line breaks (a comma can be part of a name). */
export function splitCapabilityNames(cell: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of cell.split(/[;\n]/)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function parseGoalsRows(cells: readonly (readonly string[])[]): ParseGoalsResult {
  const headingIndex = cells.findIndex((row) => row.some((cell) => columnFor(cell) === 'title'));
  if (headingIndex < 0) return { ok: false, reason: 'no-heading' };
  const heading = cells[headingIndex] ?? [];
  const at: Partial<Record<GoalColumn, number>> = {};
  heading.forEach((cell, i) => {
    const column = columnFor(cell);
    if (column !== null && at[column] === undefined) at[column] = i;
  });
  const read = (row: readonly string[], column: GoalColumn): string => {
    const i = at[column];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const rows: ParsedGoalRow[] = [];
  cells.slice(headingIndex + 1).forEach((row, offset) => {
    if (row.every((cell) => cell.trim() === '')) return;
    rows.push({ rowNumber: headingIndex + offset + 2, title: read(row, 'title'), statement: read(row, 'statement'), whyNow: read(row, 'whyNow'), capabilityNames: splitCapabilityNames(read(row, 'capabilities')) });
  });
  if (rows.length === 0) return { ok: false, reason: 'no-rows' };
  if (rows.length > GOALS_IMPORT_MAX_ROWS) return { ok: false, reason: 'too-many', max: GOALS_IMPORT_MAX_ROWS };
  return { ok: true, rows };
}

export type PlannedGoalStatus = 'new' | 'exists' | 'repeated' | 'invalid';

export interface PlannedGoal {
  rowNumber: number;
  status: PlannedGoalStatus;
  title: string;
  input: GoalInput | null;
  problem: GoalInputProblem | null;
  /** Capabilities found by name, to link when the goal is added. */
  capabilityIds: string[];
  /** Names that match no capability (or more than one), left unlinked. */
  unmatchedCapabilityNames: string[];
}

export const PROBLEM_WORDS: Record<GoalInputProblem, string> = {
  'title-empty': 'has no title',
  'title-too-long': 'has a title over 120 characters',
  'statement-empty': 'does not say what success looks like',
  'statement-too-long': 'has a success line over 500 characters',
  'why-now-too-long': 'has a "why now" over 500 characters',
};

export function planGoalsImport(rows: readonly ParsedGoalRow[], existingGoals: readonly { title: string }[], capabilities: readonly { element_id: string; name: string }[]): PlannedGoal[] {
  const existingKeys = new Set(existingGoals.map((g) => g.title.trim().toLowerCase()));
  const taken = new Set(existingKeys);
  const byName = new Map<string, string[]>();
  for (const c of capabilities) {
    const key = c.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), c.element_id]);
  }
  return rows.map((row): PlannedGoal => {
    const checked = checkGoalInput({ title: row.title, statement: row.statement, whyNow: row.whyNow });
    if (!checked.ok) return { rowNumber: row.rowNumber, status: 'invalid', title: row.title, input: null, problem: checked.problem, capabilityIds: [], unmatchedCapabilityNames: [] };
    const key = checked.value.title.toLowerCase();
    const base = { rowNumber: row.rowNumber, title: checked.value.title, input: checked.value, problem: null };
    if (taken.has(key)) return { ...base, status: existingKeys.has(key) ? 'exists' : 'repeated', capabilityIds: [], unmatchedCapabilityNames: [] };
    taken.add(key);
    const capabilityIds: string[] = [];
    const unmatchedCapabilityNames: string[] = [];
    for (const name of row.capabilityNames) {
      const found = byName.get(name.toLowerCase()) ?? [];
      if (found.length === 1 && found[0] !== undefined) capabilityIds.push(found[0]);
      else unmatchedCapabilityNames.push(name);
    }
    return { ...base, status: 'new', capabilityIds, unmatchedCapabilityNames };
  });
}

export function summarisePlan(plan: readonly PlannedGoal[]): { add: number; exists: number; repeated: number; invalid: number; unmatched: number } {
  return {
    add: plan.filter((p) => p.status === 'new').length,
    exists: plan.filter((p) => p.status === 'exists').length,
    repeated: plan.filter((p) => p.status === 'repeated').length,
    invalid: plan.filter((p) => p.status === 'invalid').length,
    unmatched: plan.reduce((n, p) => n + (p.status === 'new' ? p.unmatchedCapabilityNames.length : 0), 0),
  };
}
