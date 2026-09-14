/**
 * Unit tests for src/ui/elements/elementBrowseCsv.ts (F8, issue #162).
 */
import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BrowseRow } from '../../db/elementBrowse';
import type { AttributeDefinitionRow } from '../../db/types';
import { elementBrowseRowsToCsv, sanitizeForFilename } from './elementBrowseCsv';

function element(id: string, type: ElementsHeadRow['element_type'], name: string, attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, element_type: type, name, parent_id: null, attributes: attributes as never, exists_delta_id: `${id}-create` };
}

function browseRow(el: ElementsHeadRow, owner: ElementsHeadRow | null = null, lifecycleStatus: string | null = null): BrowseRow {
  return { element: el, owner, lifecycleStatus };
}

function definition(key: string, label: string): AttributeDefinitionRow {
  return { id: 'def-1', org_id: 'org', key, label, kind: 'text', options: null, applies_to: ['system'], required: false, description: null, order_index: 0, deprecated_at: null, created_by: 'user', created_at: '2026-01-01T00:00:00.000Z' };
}

describe('elementBrowseRowsToCsv', () => {
  it('produces a header row and one row per element, no custom column when none is selected', () => {
    const rows = [browseRow(element('a', 'system', 'Alpha'), element('o', 'actor', 'Team A'), 'active'), browseRow(element('b', 'capability', 'Beta'))];
    const csv = elementBrowseRowsToCsv(rows, undefined);
    expect(csv).toBe(['Name,Type,Owner,Lifecycle', 'Alpha,system,Team A,active', 'Beta,capability,,'].join('\r\n'));
  });

  it('adds the selected custom-attribute column, formatted the same way the table cell would be', () => {
    const rows = [browseRow(element('a', 'system', 'Alpha', { criticality: 'high' }))];
    const csv = elementBrowseRowsToCsv(rows, definition('criticality', 'Criticality'));
    expect(csv).toBe(['Name,Type,Owner,Lifecycle,Criticality', 'Alpha,system,,,high'].join('\r\n'));
  });

  it('quotes a cell containing a comma, quote, or newline, doubling any embedded quote', () => {
    const rows = [browseRow(element('a', 'system', 'Alpha, "the" first\nsystem'))];
    const csv = elementBrowseRowsToCsv(rows, undefined);
    expect(csv.split('\r\n')[1]).toBe('"Alpha, ""the"" first\nsystem",system,,');
  });

  it('an empty row set still produces a header-only CSV', () => {
    expect(elementBrowseRowsToCsv([], undefined)).toBe('Name,Type,Owner,Lifecycle');
  });

  it('formats a boolean custom attribute as Yes/No, matching the table cell convention', () => {
    const rows = [browseRow(element('a', 'system', 'Alpha', { flagged: true })), browseRow(element('b', 'system', 'Beta', { flagged: false }))];
    const csv = elementBrowseRowsToCsv(rows, definition('flagged', 'Flagged'));
    expect(csv.split('\r\n').slice(1)).toEqual(['Alpha,system,,,Yes', 'Beta,system,,,No']);
  });
});

describe('sanitizeForFilename', () => {
  it('replaces filesystem-unsafe characters with a hyphen', () => {
    expect(sanitizeForFilename('systems/containers:2026')).toBe('systems-containers-2026');
  });

  it('leaves an already-safe name untouched', () => {
    expect(sanitizeForFilename('capability')).toBe('capability');
  });

  it('falls back to "export" for a name that sanitizes to nothing', () => {
    expect(sanitizeForFilename('   ')).toBe('export');
  });
});
