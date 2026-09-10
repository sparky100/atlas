import { describe, expect, it } from 'vitest';
import { buildCapabilityMapExport, exportPendingReviewPlaceholder, todayIsoDate } from './exportCapabilityMap';
import type { ElementsHeadRow, Json } from '../contracts/rows';

function capability(id: string, name: string, parentId: string | null, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes, exists_delta_id: `d-${id}` };
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
