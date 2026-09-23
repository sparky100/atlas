import { describe, expect, it } from 'vitest';
import type { RelationshipProposal } from '../contracts/capture';
import type { RawSheet } from './parse/sheetGrid';
import { isRelationshipsSheet, relationshipSheetToCandidates } from './relationshipSheetToCandidates';

function run(headers: string[], dataRows: string[][]) {
  const grid = [headers, ...dataRows];
  const rawSheet: RawSheet = { sheetName: 'Relationships', grid, cellMeta: new Map() };
  const headerColumnRefs = headers.map((_, i) => String.fromCharCode(65 + i));
  return relationshipSheetToCandidates({ sheetName: 'Relationships', headers, headerColumnRefs, rawSheet, headerRowIndex: 0 });
}

describe('isRelationshipsSheet (Sprint F2b, SPEC-capture.md §5.2a)', () => {
  it('matches by sheet name alone', () => {
    expect(isRelationshipsSheet('Relationships', ['A', 'B'])).toBe(true);
    expect(isRelationshipsSheet('Integrations', ['A', 'B'])).toBe(true);
  });

  it('matches by header shape when the name does not match', () => {
    expect(isRelationshipsSheet('Sheet2', ['from', 'type', 'to', 'description'])).toBe(true);
  });

  it('is case-insensitive on header names', () => {
    expect(isRelationshipsSheet('Sheet2', ['From', 'Type', 'To'])).toBe(true);
  });

  it('does not match an ordinary element sheet', () => {
    expect(isRelationshipsSheet('Applications', ['Application', 'Supplier', 'Status'])).toBe(false);
  });
});

describe('relationshipSheetToCandidates (Sprint F2b, SPEC-capture.md §5.2a)', () => {
  it('produces an unresolved uses candidate with the verb phrase in attributes.description', () => {
    const [candidate] = run(['from', 'type', 'to', 'description'], [['CRM', 'uses', 'Billing', 'reads customer records']]);
    expect(candidate?.proposal).toEqual({ kind: 'relationship', relationshipType: 'uses', from: { kind: 'unresolved', text: 'CRM' }, to: { kind: 'unresolved', text: 'Billing' }, attributes: { description: 'reads customer records' } });
  });

  it('carries via as viaHint, not inside attributes', () => {
    const [candidate] = run(['from', 'type', 'to', 'description', 'via'], [['CRM', 'uses', 'Billing', 'reads records', 'Enterprise Bus']]);
    expect(candidate?.viaHint).toBe('Enterprise Bus');
    expect(candidate?.proposal).not.toHaveProperty('attributes.via');
  });

  it('attaches data_classification on a flows_to row, never on a uses row', () => {
    const flowsCandidates = run(['from', 'type', 'to', 'description', 'data_classification'], [['CRM', 'flows_to', 'Warehouse', 'sends nightly extract', 'official']]);
    expect((flowsCandidates[0]?.proposal as RelationshipProposal<'flows_to'>).attributes).toEqual({ description: 'sends nightly extract', dataClassification: 'official' });

    const usesCandidates = run(['from', 'type', 'to', 'description', 'data_classification'], [['CRM', 'uses', 'Billing', 'reads records', 'official']]);
    expect(usesCandidates[0]?.proposal.attributes).toEqual({ description: 'reads records' });
  });

  it('skips a row with a blank description entirely, rather than producing an invalid candidate', () => {
    const candidates = run(['from', 'type', 'to', 'description'], [['CRM', 'uses', 'Billing', '']]);
    expect(candidates).toHaveLength(0);
  });

  it('skips a row with an unrecognised type', () => {
    const candidates = run(['from', 'type', 'to', 'description'], [['CRM', 'depends_on', 'Billing', 'something']]);
    expect(candidates).toHaveLength(0);
  });

  it('skips a row with a blank from or to', () => {
    const candidates = run(['from', 'type', 'to', 'description'], [['', 'uses', 'Billing', 'x'], ['CRM', 'uses', '', 'x']]);
    expect(candidates).toHaveLength(0);
  });

  it('returns no candidates when the sheet lacks from/type/to columns', () => {
    expect(run(['Application', 'Supplier'], [['CRM', 'Acme']])).toHaveLength(0);
  });
});
