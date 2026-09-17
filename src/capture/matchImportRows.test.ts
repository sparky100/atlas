import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../contracts/rows';
import type { ImportRow } from './importRowSchema';
import { matchImportRows } from './matchImportRows';

function system(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `${id}-create` };
}
function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `${id}-create` };
}
function row(overrides: Partial<ImportRow> & { rowNumber: number; name: string }): ImportRow {
  return { id: null, attributes: {}, supportsCapabilityName: null, ...overrides };
}

describe('matchImportRows', () => {
  it('matches a row by exact id, ignoring name entirely', () => {
    const systems = [system('sys-1', 'Old Name')];
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'A Completely Different Name', id: 'sys-1' })], systems, []);
    expect(result?.match).toEqual({ kind: 'matched', element: { elementId: 'sys-1', name: 'Old Name' } });
  });

  it('treats an id that does not resolve to any live system as new, not an error', () => {
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Northgate', id: 'sys-does-not-exist' })], [system('sys-1', 'Northgate')], []);
    expect(result?.match).toEqual({ kind: 'new' });
  });

  it('matches by exact normalized name when no id is given', () => {
    const systems = [system('sys-1', 'Northgate')];
    const [result] = matchImportRows([row({ rowNumber: 2, name: '  NORTHGATE  ' })], systems, []);
    expect(result?.match).toEqual({ kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } });
  });

  it('is new when no system matches by id or name', () => {
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Brand New System' })], [system('sys-1', 'Northgate')], []);
    expect(result?.match).toEqual({ kind: 'new' });
  });

  it('flags an ambiguous match when two live systems share the exact normalized name', () => {
    const systems = [system('sys-1', 'Northgate'), system('sys-2', 'northgate')];
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Northgate' })], systems, []);
    expect(result?.match.kind).toBe('ambiguous');
    if (result?.match.kind === 'ambiguous') {
      expect(result.match.candidates.map((c) => c.elementId).sort()).toEqual(['sys-1', 'sys-2']);
    }
  });

  it('resolves the supports column against capabilities by exact name', () => {
    const capabilities = [capability('cap-1', 'Billing')];
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Northgate', supportsCapabilityName: 'Billing' })], [], capabilities);
    expect(result?.supports).toEqual({ kind: 'matched', capability: { elementId: 'cap-1', name: 'Billing' } });
  });

  it('leaves supports unresolved (never auto-created) when the named capability does not exist', () => {
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Northgate', supportsCapabilityName: 'Nonexistent' })], [], [capability('cap-1', 'Billing')]);
    expect(result?.supports).toEqual({ kind: 'unresolved', name: 'Nonexistent' });
  });

  it('leaves supports as none when the row does not name one', () => {
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Northgate' })], [], [capability('cap-1', 'Billing')]);
    expect(result?.supports).toEqual({ kind: 'none' });
  });

  it('flags supports as ambiguous when two capabilities share the exact normalized name', () => {
    const capabilities = [capability('cap-1', 'Billing'), capability('cap-2', 'BILLING')];
    const [result] = matchImportRows([row({ rowNumber: 2, name: 'Northgate', supportsCapabilityName: 'Billing' })], [], capabilities);
    expect(result?.supports.kind).toBe('ambiguous');
  });
});
