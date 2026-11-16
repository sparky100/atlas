import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FactsRow } from '../contracts/rows';
import { callTool, MODEL_TOOLS } from './index';
import { clip, MAX_TEXT_CHARS, MAX_TOOL_ROWS } from './limits';
import type { ToolResult } from './types';
import { edge, element, estateContext, estateSnapshot, savedReport, uid } from './fixtures/estateSnapshot';

function ok(result: ToolResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}
function failed(result: ToolResult): string {
  if (result.ok) throw new Error('expected an error result');
  return result.error;
}
type Rec = Record<string, unknown>;
const data = (r: ToolResult) => ok(r).data as Rec;

describe('every tool', () => {
  it('is read-only and bounded by construction: no write verbs in its name, no .in() over a growing list in its source', () => {
    for (const tool of MODEL_TOOLS) expect(tool.name).not.toMatch(/create|update|delete|write|set_|add_|remove|retire|merge|propose/);
    for (const file of readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/[\w)]\.in\(/);
      expect(source, file).not.toMatch(/from '\.\.\/ui\//); // ADR-028: the tools layer does not import from src/ui
      expect(source, file).not.toMatch(/[\w)]\.(insert|update|upsert|delete|rpc)\(/);
    }
  });

  it('describes its input as a JSON Schema object', () => {
    for (const tool of MODEL_TOOLS) expect((tool.inputSchema as { type?: string }).type, tool.name).toBe('object');
  });

  it('states what it read in every result', async () => {
    const result = ok(await callTool(estateContext(), 'search_elements', { query: 'billing' }));
    expect(result.stamp).toEqual({ modelId: uid(901), modelName: 'Test estate', ref: 'main', commitId: uid(903) });
  });

  it('answers an unknown tool or bad input with an error the assistant can read, never a throw', async () => {
    const ctx = estateContext();
    expect(failed(await callTool(ctx, 'delete_everything', {}))).toMatch(/no tool called/i);
    expect(failed(await callTool(ctx, 'get_element', { elementId: 'not-an-id' }))).toMatch(/Invalid input for get_element/);
    expect(failed(await callTool(ctx, 'search_elements', { query: 'x' }))).toMatch(/at least 2/);
    expect(failed(await callTool(ctx, 'search_elements', { query: 'crm', surprise: true }))).toMatch(/Invalid input/);
  });

  it('gives the same answer to the same question', async () => {
    const ctx = estateContext();
    const input = { filters: [{ field: 'supportEndsAt', operator: 'lt', value: '2028-01-01' }] };
    expect(await callTool(ctx, 'find_elements', input)).toEqual(await callTool(ctx, 'find_elements', input));
  });
});

describe('clip', () => {
  it('cuts long text and says so, and drops control characters', () => {
    expect(clip('a'.repeat(MAX_TEXT_CHARS + 10))).toContain('cut at 500');
    expect(clip('ab\u0007c\nd')).toBe('abc\nd');
    expect(clip('short')).toBe('short');
  });
});

describe('search_elements', () => {
  it('finds by name, by alias, and within one type', async () => {
    const ctx = estateContext();
    const byName = (await callTool(ctx, 'search_elements', { query: 'billing' })) as Extract<ToolResult, { ok: true }>;
    const names = ((byName.data as { matches: { name: string }[] }).matches).map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['Billing', 'Billing Engine']));
    const byAlias = data(await callTool(ctx, 'search_elements', { query: 'Customer Relationship Manager' })) as { matches: { id: string }[] };
    expect(byAlias.matches.map((m) => m.id)).toContain(uid(10));
    const systemsOnly = data(await callTool(ctx, 'search_elements', { query: 'billing', type: 'system' })) as { matches: { type: string }[] };
    expect(systemsOnly.matches.every((m) => m.type === 'system')).toBe(true);
  });

  it('caps its results and reports the true count', async () => {
    const many = Array.from({ length: 70 }, (_, i) => element(1000 + i, 'system', `Widget ${String(i).padStart(2, '0')}`));
    const result = ok(await callTool(estateContext({ snapshot: estateSnapshot({ elements: many }) }), 'search_elements', { query: 'widget', limit: MAX_TOOL_ROWS }));
    expect((result.data as { matches: unknown[] }).matches).toHaveLength(MAX_TOOL_ROWS);
    expect(result.total).toBe(70);
    expect(result.truncated).toBe(true);
    expect(failed(await callTool(estateContext(), 'search_elements', { query: 'widget', limit: MAX_TOOL_ROWS + 1 }))).toMatch(/Invalid input/);
  });
});

describe('get_element', () => {
  const fact = (attribute: string): FactsRow => ({ subject_type: 'element', subject_id: uid(10), attribute, value: 'x', delta_id: uid(1), source_id: uid(2), source_ref: 'CMDB export', effective_date: '2026-10-01', confidence: 0.8, asserted_by: uid(3), asserted_at: '' });

  it('returns the element with owner, lifecycle, attributes with provenance, and relationship counts', async () => {
    const d = data(await callTool(estateContext({ facts: [fact('criticality')] }), 'get_element', { elementId: uid(10) }));
    expect(d.name).toBe('CRM Platform');
    expect(d.owner).toMatchObject({ id: uid(20), name: 'Ada Lovelace' });
    expect(d.lifecycle).toBe('active');
    expect(d.criticality).toBe('high');
    expect(d.relationshipCounts).toEqual({ supports: 1, owns: 1, uses: 1 });
    const attrs = d.attributes as { attribute: string; provenance?: { source: string; confidence: number } }[];
    expect(attrs.find((a) => a.attribute === 'criticality')?.provenance).toMatchObject({ source: 'CMDB export', confidence: 0.8 });
    expect(attrs.find((a) => a.attribute === 'lifecycleStatus')?.provenance).toBeUndefined();
    expect((d.children as { name: string }[]).map((c) => c.name)).toEqual(['Onboarding Module']);
  });

  it('says plainly when there is no such element', async () => {
    expect(failed(await callTool(estateContext(), 'get_element', { elementId: uid(4242) }))).toMatch(/No element with that id/);
  });

  it('cuts long free text', async () => {
    const long = element(50, 'system', 'Long One', { description: 'z'.repeat(2000) });
    const d = data(await callTool(estateContext({ snapshot: estateSnapshot({ elements: [long] }) }), 'get_element', { elementId: uid(50) }));
    const text = (d.attributes as { attribute: string; value: string }[]).find((a) => a.attribute === 'description')?.value ?? '';
    expect(text.length).toBeLessThan(600);
    expect(text).toContain('cut at');
  });
});

describe('list_relationships', () => {
  it('lists both directions, filters by type and direction, and names the other end', async () => {
    const ctx = estateContext();
    const all = data(await callTool(ctx, 'list_relationships', { elementId: uid(10) })) as { relationships: { type: string; direction: string; other: { name: string } }[] };
    expect(all.relationships).toHaveLength(3);
    expect(all.relationships.find((r) => r.type === 'owns')).toMatchObject({ direction: 'to', other: { name: 'Ada Lovelace' } });
    const supports = data(await callTool(ctx, 'list_relationships', { elementId: uid(1), type: 'supports', direction: 'to' })) as { relationships: { other: { name: string } }[] };
    expect(supports.relationships.map((r) => r.other.name).sort()).toEqual(['CRM Platform', 'Legacy Portal']);
    expect(data(await callTool(ctx, 'list_relationships', { elementId: uid(1), direction: 'from' })).relationships).toEqual([]);
  });

  it('caps and reports the true count', async () => {
    const extra = Array.from({ length: 30 }, (_, i) => edge(2000 + i, 'uses', 10, 13, { label: `call ${String(i)}` }));
    const result = ok(await callTool(estateContext({ snapshot: estateSnapshot({ relationships: extra }) }), 'list_relationships', { elementId: uid(10), type: 'uses' }));
    expect((result.data as { relationships: unknown[] }).relationships).toHaveLength(20);
    expect(result.total).toBe(31);
    expect(result.truncated).toBe(true);
  });
});

describe('find_elements', () => {
  it('answers "which systems reach end of support before 2028" and includes ids to cite', async () => {
    const result = ok(await callTool(estateContext(), 'find_elements', { type: 'system', filters: [{ field: 'supportEndsAt', operator: 'lt', value: '2028-01-01' }], columns: ['name', 'owner', 'supportEndsAt'], sortBy: 'supportEndsAt' }));
    const rows = (result.data as { rows: Rec[] }).rows;
    expect(rows.map((r) => r.name)).toEqual(['Billing Engine', 'CRM Platform']);
    expect(rows[0]).toMatchObject({ id: uid(11), owner: 'Grace Hopper', supportEndsAt: '2026-12-31' });
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('cuts to the limit but reports the true total, and sorts descending', async () => {
    const result = ok(await callTool(estateContext(), 'find_elements', { type: 'system', limit: 2, sortBy: 'name', sortDirection: 'desc' }));
    expect((result.data as { rows: Rec[] }).rows.map((r) => r.name)).toEqual(['Legacy Portal', 'Data Warehouse']);
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('says so when a field has no recorded values anywhere', async () => {
    const d = data(await callTool(estateContext(), 'find_elements', { filters: [{ field: 'nonexistentAttr', operator: 'eq', value: 'x' }] }));
    expect(d.unknownFields).toEqual(['nonexistentAttr']);
    expect(d.rows).toEqual([]);
  });

  it('refuses internal helper fields and bad filters with a readable reason', async () => {
    const ctx = estateContext();
    expect(failed(await callTool(ctx, 'find_elements', { sortBy: 'criticalityRank' }))).toMatch(/not a field you can use/);
    expect(failed(await callTool(ctx, 'find_elements', { filters: [{ field: 'name', operator: 'between', value: 'x' }] }))).toMatch(/Invalid input/);
    expect(failed(await callTool(ctx, 'find_elements', { filters: Array.from({ length: 11 }, () => ({ field: 'name', operator: 'eq', value: 'x' })) }))).toMatch(/Invalid input/);
  });
});

describe('saved reports', () => {
  const base = { specVersion: 1, source: 'elements', filters: [{ field: 'type', operator: 'eq', value: 'system' }], columns: ['name', 'lifecycle'], sort: [{ field: 'name', direction: 'asc' }] };
  const reports = [
    savedReport(300, 'Systems', { ...base, presentation: { kind: 'table' } }),
    savedReport(301, 'Systems by lifecycle', { ...base, groupBy: 'lifecycle', presentation: { kind: 'barByField' } }),
    savedReport(302, 'Portfolio costs', { ...base, source: 'portfolio', presentation: { kind: 'table' } }),
  ];

  it('lists the reports it can see and runs one', async () => {
    const ctx = estateContext({ reports });
    const list = data(await callTool(ctx, 'list_saved_reports', {})) as { reports: { name: string; about: string }[] };
    expect(list.reports.map((r) => r.name)).toEqual(['Systems', 'Systems by lifecycle', 'Portfolio costs']);
    const ran = data(await callTool(ctx, 'run_saved_report', { reportId: uid(300) })) as { rows: Rec[] };
    expect(ran.rows.map((r) => r.name)).toEqual(['Billing Engine', 'CRM Platform', 'Data Warehouse', 'Legacy Portal']);
    const grouped = data(await callTool(ctx, 'run_saved_report', { reportId: uid(301) })) as { groups: { value: string; count: number }[] };
    expect(grouped.groups).toEqual([{ value: 'active', count: 3 }, { value: 'retiring', count: 1 }]);
  });

  it('refuses a report about another source, and one it cannot see, in plain words', async () => {
    const ctx = estateContext({ reports });
    expect(failed(await callTool(ctx, 'run_saved_report', { reportId: uid(302) }))).toMatch(/portfolio.*can't run yet/);
    expect(failed(await callTool(ctx, 'run_saved_report', { reportId: uid(777) }))).toMatch(/No saved report with that id/);
  });
});

describe('list_health_findings', () => {
  it('counts every check, and lists the elements one flagged, by the product\'s own definitions', async () => {
    const ctx = estateContext();
    const all = data(await callTool(ctx, 'list_health_findings', {})) as { findings: { finding: string; label: string; count: number }[] };
    expect(all.findings).toHaveLength(14);
    const count = (key: string) => all.findings.find((f) => f.finding === key)?.count;
    expect(count('unlinked-systems')).toBe(1); // Data Warehouse supports nothing
    expect(count('no-technical-owner')).toBeGreaterThan(0);
    expect(count('ai-agent-no-technical-owner')).toBe(0); // the fixture estate has no AI agents

    const unlinked = ok(await callTool(ctx, 'list_health_findings', { finding: 'unlinked-systems' }));
    expect((unlinked.data as { elements: { id: string; name: string }[] }).elements).toEqual([expect.objectContaining({ id: uid(13), name: 'Data Warehouse' })]);
    expect(unlinked.total).toBe(1);
  });

  it('uses the injected clock for date-based findings', async () => {
    const result = data(await callTool(estateContext(), 'list_health_findings', { finding: 'critical-support-end' })) as { elements: { name: string }[] };
    // Billing Engine is critical and its support ended 2026-12-31, within the stale window of the fixture's "today" (2026-11-06).
    expect(result.elements.map((e) => e.name)).toContain('Billing Engine');
  });

  it('refuses an unknown finding key', async () => {
    expect(failed(await callTool(estateContext(), 'list_health_findings', { finding: 'everything' }))).toMatch(/Invalid input/);
  });
});

describe('portfolio_signals', () => {
  const costly = (n: number, name: string, attrs: Record<string, string>) => element(n, 'system', name, { annualRunCost: '1m_5m', ...attrs });

  it('counts each signal, and lists the rows one fires on', async () => {
    const snapshot = estateSnapshot({
      elements: [costly(60, 'Pricey Poor', { criticality: 'low' }), costly(61, 'Pricey Fine', { criticality: 'critical' })],
      relationships: [edge(3000, 'supports', 60, 1, { fitForPurpose: 'poor' }), edge(3001, 'supports', 61, 2, { fitForPurpose: 'excellent' })],
    });
    const ctx = estateContext({ snapshot });
    const counts = data(await callTool(ctx, 'portfolio_signals', {})) as { rows: number; signals: { signal: string; count: number }[] };
    expect(counts.rows).toBeGreaterThan(4);
    expect(counts.signals.find((s) => s.signal === 'costly_poor_fit')?.count).toBe(1);
    expect(counts.signals.find((s) => s.signal === 'justified')?.count).toBe(1);

    const poor = ok(await callTool(ctx, 'portfolio_signals', { signal: 'costly_poor_fit' }));
    const rows = (poor.data as { rows: Rec[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: uid(60), name: 'Pricey Poor', fit: 'poor', cost: '1m_5m' });
    expect(poor.total).toBe(1);
  });

  it('refuses an unknown signal', async () => {
    expect(failed(await callTool(estateContext(), 'portfolio_signals', { signal: 'bad' }))).toMatch(/Invalid input/);
  });
});
