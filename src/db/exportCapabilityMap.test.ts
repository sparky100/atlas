import { describe, expect, it } from 'vitest';
import { buildCapabilityMapExport, buildValueStreamExport, exportPendingReviewPlaceholder, todayIsoDate } from './exportCapabilityMap';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../contracts/rows';

function capability(id: string, name: string, parentId: string | null, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes, exists_delta_id: `d-${id}` };
}

function valueStreamEl(id: string, name: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'value_stream', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function enablesEdge(id: string, fromId: string, toId: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'enables', from_element_id: fromId, to_element_id: toId, attributes: {}, exists_delta_id: `d-${id}` };
}

const SOURCE = { citation: 'Exported from Atlas model "Test Model" (test-org/test-model)', reviewedBy: exportPendingReviewPlaceholder('Test Model'), reviewedAt: '2026-01-01' };

describe('buildCapabilityMapExport (Sprint U4-1 C6)', () => {
  it('generates fresh dotted codes from tree structure, not from any existing attributes.code', () => {
    const capabilities = [
      capability('root', 'Digital Services', null, { code: 'stale-1', order: 999 }),
      capability('mid', 'Housing', 'root', { code: 'stale-1.1' }),
      capability('leaf', 'Repairs', 'mid'),
    ];
    const content = buildCapabilityMapExport(capabilities, { sector: 'housing', version: 1, title: 'Housing Association', summary: 'summary', sourceDescription: 'desc', source: SOURCE });
    expect(content.items).toEqual([
      { code: '1', name: 'Digital Services', description: undefined, level: 1, parentCode: null, order: 10 },
      { code: '1.1', name: 'Housing', description: undefined, level: 2, parentCode: '1', order: 10 },
      { code: '1.1.1', name: 'Repairs', description: undefined, level: 3, parentCode: '1.1', order: 10 },
    ]);
  });

  it('orders siblings by multiples of ten, in display order (compareCapabilities), not by input array order', () => {
    const capabilities = [capability('b', 'Beta', null, { order: 5 }), capability('a', 'Alpha', null, { order: 1 })];
    const content = buildCapabilityMapExport(capabilities, { sector: 'housing', version: 1, title: 'Housing Association', summary: 'summary', sourceDescription: 'desc', source: SOURCE });
    expect(content.items.map((i) => [i.code, i.name, i.order])).toEqual([
      ['1', 'Alpha', 10],
      ['2', 'Beta', 20],
    ]);
  });

  it('carries a real description through, trimmed presence only — a missing or whitespace-only one becomes undefined, not an empty string', () => {
    const capabilities = [
      capability('a', 'Alpha', null, { description: 'What this capability covers.' }),
      capability('b', 'Beta', null, { description: '   ' }),
      capability('c', 'Gamma', null),
    ];
    const content = buildCapabilityMapExport(capabilities, { sector: 'housing', version: 1, title: 'Housing Association', summary: 'summary', sourceDescription: 'desc', source: SOURCE });
    expect(content.items.map((i) => i.description)).toEqual(['What this capability covers.', undefined, undefined]);
  });

  it('excludes orphans (a broken or too-deep parent chain) — nothing to export for a shape the schema cannot represent', () => {
    const capabilities = [capability('a', 'Alpha', null), capability('orphan', 'Orphaned', 'missing-parent')];
    const content = buildCapabilityMapExport(capabilities, { sector: 'housing', version: 1, title: 'Housing Association', summary: 'summary', sourceDescription: 'desc', source: SOURCE });
    expect(content.items.map((i) => i.name)).toEqual(['Alpha']);
  });

  it('drops every model-specific attribute — only code/name/description/level/parentCode/order survive', () => {
    const capabilities = [capability('a', 'Alpha', null, { code: 'x', templateRef: 'y', order: 42, someFutureAttribute: 'z' })];
    const content = buildCapabilityMapExport(capabilities, { sector: 'housing', version: 1, title: 'Housing Association', summary: 'summary', sourceDescription: 'desc', source: SOURCE });
    expect(Object.keys(content.items[0] ?? {}).sort()).toEqual(['code', 'description', 'level', 'name', 'order', 'parentCode']);
  });

  it('carries sector, version, sourceDescription and the one source through, always as a draft', () => {
    const capabilities = [capability('a', 'Alpha', null)];
    const content = buildCapabilityMapExport(capabilities, { sector: 'nhs', version: 3, title: 'NHS Board or Trust', summary: 'summary', sourceDescription: 'Exported on 2026-01-01.', source: SOURCE });
    expect(content.sector).toBe('nhs');
    expect(content.version).toBe(3);
    expect(content.status).toBe('draft');
    expect(content.sourceDescription).toBe('Exported on 2026-01-01.');
    expect(content.sources).toEqual([SOURCE]);
  });
});

describe('buildValueStreamExport (F6/ADR-023)', () => {
  it('round-trips streams, stages and enables, resolved to capability names', () => {
    const capabilitiesById = new Map([['cap-1', capability('cap-1', 'Connections', null)]]);
    const valueStreams = [valueStreamEl('vs1', 'Getting Connected', null), valueStreamEl('vs1.1', 'Connect', 'vs1')];
    const enables = [enablesEdge('e1', 'cap-1', 'vs1.1')];
    const out = buildValueStreamExport(valueStreams, enables, capabilitiesById);
    expect(out).toEqual([
      {
        code: 'vs1',
        name: 'Getting Connected',
        description: undefined,
        order: 10,
        stages: [{ code: 'vs1.1', name: 'Connect', description: undefined, order: 10, enables: ['Connections'] }],
      },
    ]);
  });

  it('omits an enables name whose capability is not in the map', () => {
    const capabilitiesById = new Map<string, ElementsHeadRow>();
    const valueStreams = [valueStreamEl('vs1', 'Stream', null), valueStreamEl('vs1.1', 'Stage', 'vs1')];
    const enables = [enablesEdge('e1', 'cap-missing', 'vs1.1')];
    expect(buildValueStreamExport(valueStreams, enables, capabilitiesById)[0]?.stages[0]?.enables).toEqual([]);
  });
});

describe('exportPendingReviewPlaceholder', () => {
  it('names the model and matches scripts/publishCapabilityMap.ts\'s own case-insensitive "pending human review" check', () => {
    const placeholder = exportPendingReviewPlaceholder('My Model');
    expect(placeholder).toMatch(/pending human review/i);
    expect(placeholder).toContain('My Model');
  });
});

describe('todayIsoDate', () => {
  it('formats as YYYY-MM-DD, the shape the content schema requires for reviewedAt', () => {
    expect(todayIsoDate(new Date('2026-03-05T13:45:00Z'))).toBe('2026-03-05');
  });
});
