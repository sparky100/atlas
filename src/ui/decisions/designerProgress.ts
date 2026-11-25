import type { AskEvent } from '../../tools/askLoop';

/**
 * One line of the Designer's progress list: a kind of lookup, however many
 * times the Designer ran it. The Designer often searches the model or reads an
 * element several times in one run; one line per call showed the same words
 * over and over (Simon, 2026-11-25).
 */
export interface DesignerStep {
  name: string;
  /** How many times the Designer has started this lookup in this run. */
  calls: number;
  /** Calls started and not yet finished. */
  open: number;
  /** Finished calls that found something. */
  found: number;
}

/** Pure: the list after one progress event. Lines keep the order the lookups were first used. */
export function applyDesignerEvent(steps: readonly DesignerStep[], event: AskEvent): DesignerStep[] {
  const at = steps.findIndex((step) => step.name === event.name);
  if (event.type === 'tool_call') {
    if (at < 0) return [...steps, { name: event.name, calls: 1, open: 1, found: 0 }];
    return steps.map((step, i) => (i === at ? { ...step, calls: step.calls + 1, open: step.open + 1 } : step));
  }
  return steps.map((step, i) => (i === at && step.open > 0 ? { ...step, open: step.open - 1, found: step.found + (event.ok ? 1 : 0) } : step));
}

/** Pure: true once every lookup started so far has finished. */
export function allStepsDone(steps: readonly DesignerStep[]): boolean {
  return steps.every((step) => step.open === 0);
}

/** Pure: the words after a step's label, e.g. " (3 times)…", " ✓", " — nothing found". */
export function stepSuffix(step: DesignerStep): string {
  const times = step.calls > 1 ? ` (${String(step.calls)} times)` : '';
  if (step.open > 0) return `${times}…`;
  return step.found > 0 ? `${times} ✓` : `${times} — nothing found`;
}
