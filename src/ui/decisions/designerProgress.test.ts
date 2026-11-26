import { describe, expect, it } from 'vitest';
import type { AskEvent } from '../../tools/askLoop';
import { allStepsDone, applyDesignerEvent, stepSuffix, type DesignerStep } from './designerProgress';

const run = (events: AskEvent[]): DesignerStep[] => events.reduce<DesignerStep[]>(applyDesignerEvent, []);
const suffixes = (steps: DesignerStep[]): string[] => steps.map(stepSuffix);

describe('Designer progress list', () => {
  it('shows a lookup the Designer runs three times as one line, with a count', () => {
    const steps = run([
      { type: 'tool_call', name: 'search_elements' },
      { type: 'tool_done', name: 'search_elements', ok: true },
      { type: 'tool_call', name: 'get_element' },
      { type: 'tool_call', name: 'search_elements' },
      { type: 'tool_done', name: 'search_elements', ok: false },
      { type: 'tool_call', name: 'search_elements' },
      { type: 'tool_done', name: 'get_element', ok: true },
      { type: 'tool_done', name: 'search_elements', ok: true },
    ]);
    expect(steps.map((s) => s.name)).toEqual(['search_elements', 'get_element']);
    expect(steps[0]).toEqual({ name: 'search_elements', calls: 3, open: 0, found: 2 });
    expect(suffixes(steps)).toEqual([' (3 times) ✓', ' ✓']);
    expect(allStepsDone(steps)).toBe(true);
  });

  it('stays in progress while any call of a lookup is still running', () => {
    const steps = run([
      { type: 'tool_call', name: 'search_elements' },
      { type: 'tool_call', name: 'search_elements' },
      { type: 'tool_done', name: 'search_elements', ok: true },
    ]);
    expect(suffixes(steps)).toEqual([' (2 times)…']);
    expect(allStepsDone(steps)).toBe(false);
  });

  it('says nothing was found only when no call found anything', () => {
    const steps = run([
      { type: 'tool_call', name: 'find_catalogue_products' },
      { type: 'tool_done', name: 'find_catalogue_products', ok: false },
    ]);
    expect(suffixes(steps)).toEqual([' — nothing found']);
  });

  it('ignores a finish with no matching start', () => {
    expect(run([{ type: 'tool_done', name: 'get_element', ok: true }])).toEqual([]);
  });
});
