import { describe, expect, it } from 'vitest';
import { callTool } from './index';
import { edge, element, estateContext, estateSnapshot, uid } from './fixtures/estateSnapshot';
import type { ToolResult } from './types';

type Rec = Record<string, unknown>;
const data = (r: ToolResult): Rec => {
  if (!r.ok) throw new Error(r.error);
  return r.data as Rec;
};

// A system that goes live long after the fixture's "today", and a link to it.
const FUTURE = element(30, 'system', 'Future Hub', { lifecycleStatus: 'planned', introduced: '2099-01-01', criticality: 'high' });
const ctx = () => estateContext({ snapshot: estateSnapshot({ elements: [FUTURE], relationships: [edge(300, 'flows_to', 10, 30, { description: 'sends orders to' })] }) });

describe("Ask and MCP answer for today, like the app's own views", () => {
  it('portfolio_signals leaves planned systems out, says how many, and brings them back on request', async () => {
    const today = data(await callTool(ctx(), 'portfolio_signals', {})) as { rows: number; leftOutPlannedOrRetired?: number };
    const all = data(await callTool(ctx(), 'portfolio_signals', { includePlannedAndRetired: true })) as { rows: number };
    expect(today.leftOutPlannedOrRetired).toBe(1);
    expect(all.rows).toBe(today.rows + 1);
  });

  it('list_relationships leaves out a link to a planned system unless asked', async () => {
    const today = data(await callTool(ctx(), 'list_relationships', { elementId: uid(10), type: 'flows_to' })) as { relationships: unknown[] };
    const all = data(await callTool(ctx(), 'list_relationships', { elementId: uid(10), type: 'flows_to', includePlannedAndRetired: true })) as { relationships: unknown[] };
    expect(today.relationships).toHaveLength(0);
    expect(all.relationships).toHaveLength(1);
  });

  it('search_elements still finds a planned system, marked planned', async () => {
    const found = data(await callTool(ctx(), 'search_elements', { query: 'Future Hub' })) as { matches: { lifecycleState: string }[] };
    expect(found.matches[0]?.lifecycleState).toBe('planned');
  });

  it('get_element says whether the system is planned, active or retired today, and uses the word planned action', async () => {
    const one = data(await callTool(ctx(), 'get_element', { elementId: uid(30) }));
    expect(one.lifecycleState).toBe('planned');
    expect(one).toHaveProperty('plannedAction');
    expect(one).not.toHaveProperty('disposition');
  });
});
