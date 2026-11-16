import { describe, expect, it } from 'vitest';
import { REPORT_SPEC_VERSION } from '../../contracts/reportSpec';
import type { ElementsHeadRow } from '../../contracts/rows';
import { aiAutonomyLabel, aiAutonomyOf, aiAutonomyRank, isAiAgent } from './aiAgent';
import { DEFAULT_ELEMENTS_REPORT_STATE, elementReportRow, elementsStateToSpec, specToElementsState } from './elementsReport';

function system(attributes: Record<string, string>): ElementsHeadRow {
  return { element_id: 'x', element_type: 'system', name: 'X', parent_id: null, attributes, exists_delta_id: 'd' };
}

describe('AI agent helpers', () => {
  it('reads only the three known values', () => {
    expect(aiAutonomyOf(system({ aiAutonomy: 'acts_alone' }))).toBe('acts_alone');
    expect(aiAutonomyOf(system({ aiAutonomy: 'whatever' }))).toBeNull();
    expect(aiAutonomyOf(system({}))).toBeNull();
    expect(isAiAgent(system({ aiAutonomy: 'suggests' }))).toBe(true);
    expect(isAiAgent(system({}))).toBe(false);
  });

  it('labels in plain words and ranks from not-an-agent up to acts alone', () => {
    expect(aiAutonomyLabel('acts_with_approval')).toBe('Acts with approval');
    expect(['acts_alone', null, 'suggests', 'acts_with_approval'].map((v) => aiAutonomyRank(v as never)).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2]);
  });
});

describe('Elements page and AI agents in a saved report', () => {
  const row = (attributes: Record<string, string>) => ({ element: system(attributes), owner: null, lifecycleStatus: null, criticality: null, disposition: null, parent: null });

  it('exposes how the agent acts as a report field, empty for a plain system', () => {
    expect(elementReportRow(row({ aiAutonomy: 'acts_alone' })).aiAutonomy).toBe('acts_alone');
    expect(elementReportRow(row({})).aiAutonomy).toBeNull();
    expect(elementReportRow(row({})).aiAutonomyRank).toBe(-1);
  });

  it('saves "AI agents only" as a filter, and sorting by how it acts as the rank field', () => {
    const result = elementsStateToSpec({ ...DEFAULT_ELEMENTS_REPORT_STATE, sortKey: 'aiAutonomy', sortDirection: 'desc' }, 'ai-agents');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.specVersion).toBe(REPORT_SPEC_VERSION);
    expect(result.spec.filters).toContainEqual({ field: 'aiAutonomy', operator: 'isNotEmpty', value: null });
    expect(result.spec.sort[0]).toEqual({ field: 'aiAutonomyRank', direction: 'desc' });
    // The sort alone comes back as page state; a filter the page has no checkbox for in a saved report is refused whole, as for any other.
    expect(specToElementsState({ ...result.spec, filters: [] })).toMatchObject({ ok: true, state: { sortKey: 'aiAutonomy' } });
  });

  it('still refuses to save a health-finding filter', () => {
    expect(elementsStateToSpec(DEFAULT_ELEMENTS_REPORT_STATE, 'no-technical-owner').ok).toBe(false);
  });
});
