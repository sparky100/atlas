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

const candidatesOf = (headers: string[], dataRows: string[][]) => run(headers, dataRows).candidates;

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
    const [candidate] = candidatesOf(['from', 'type', 'to', 'description'], [['CRM', 'uses', 'Billing', 'reads customer records']]);
    expect(candidate?.proposal).toEqual({ kind: 'relationship', relationshipType: 'uses', from: { kind: 'unresolved', text: 'CRM' }, to: { kind: 'unresolved', text: 'Billing' }, attributes: { description: 'reads customer records' } });
  });

  it('carries via as viaHint, not inside attributes', () => {
    const [candidate] = candidatesOf(['from', 'type', 'to', 'description', 'via'], [['CRM', 'uses', 'Billing', 'reads records', 'Enterprise Bus']]);
    expect(candidate?.viaHint).toBe('Enterprise Bus');
    expect(candidate?.proposal).not.toHaveProperty('attributes.via');
  });

  it('attaches data_classification on a flows_to row, never on a uses row', () => {
    const flowsCandidates = candidatesOf(['from', 'type', 'to', 'description', 'data_classification'], [['CRM', 'flows_to', 'Warehouse', 'sends nightly extract', 'official']]);
    expect((flowsCandidates[0]?.proposal as RelationshipProposal<'flows_to'>).attributes).toEqual({ description: 'sends nightly extract', dataClassification: 'official' });

    const usesCandidates = candidatesOf(['from', 'type', 'to', 'description', 'data_classification'], [['CRM', 'uses', 'Billing', 'reads records', 'official']]);
    expect(usesCandidates[0]?.proposal.attributes).toEqual({ description: 'reads records' });
  });

  it('skips a row with a blank description entirely, rather than producing an invalid candidate', () => {
    const { candidates, skipped } = run(['from', 'type', 'to', 'description'], [['CRM', 'uses', 'Billing', '']]);
    expect(candidates).toHaveLength(0);
    expect(skipped).toEqual([{ rowNumber: 2, reason: 'MISSING_DESCRIPTION' }]);
  });

  it('skips a row with an unrecognised type', () => {
    const { candidates, skipped } = run(['from', 'type', 'to', 'description'], [['CRM', 'depends_on', 'Billing', 'something']]);
    expect(candidates).toHaveLength(0);
    expect(skipped).toEqual([{ rowNumber: 2, reason: 'UNSUPPORTED_TYPE' }]);
  });

  it('skips a row with a blank from or to', () => {
    const { candidates, skipped } = run(['from', 'type', 'to', 'description'], [['', 'uses', 'Billing', 'x'], ['CRM', 'uses', '', 'x']]);
    expect(candidates).toHaveLength(0);
    expect(skipped.map((k) => k.reason)).toEqual(['MISSING_ENDPOINT', 'MISSING_ENDPOINT']);
  });

  it('returns no candidates when the sheet lacks from/type/to columns', () => {
    expect(run(['Application', 'Supplier'], [['CRM', 'Acme']])).toEqual({ candidates: [], skipped: [] });
  });

  it("reads this product's own export columns: a Verb column is the description, and a supports row carries its Role", () => {
    const { candidates, skipped } = run(
      ['From', 'Type', 'To', 'Verb', 'Role'],
      [
        ['PowerON', 'flows_to', 'PM', 'Receive incident reference', ''],
        ['ESCOMS', 'supports', 'Land, Wayleaves & Consents', '', 'primary'],
        ['Aurora', 'supports', 'Streetworks & Permits', '', 'secondary'],
      ],
    );
    expect(skipped).toEqual([]);
    expect(candidates.map((c) => c.proposal)).toEqual([
      { kind: 'relationship', relationshipType: 'flows_to', from: { kind: 'unresolved', text: 'PowerON' }, to: { kind: 'unresolved', text: 'PM' }, attributes: { description: 'Receive incident reference' } },
      { kind: 'relationship', relationshipType: 'supports', from: { kind: 'unresolved', text: 'ESCOMS' }, to: { kind: 'unresolved', text: 'Land, Wayleaves & Consents' }, attributes: { role: 'primary' } },
      { kind: 'relationship', relationshipType: 'supports', from: { kind: 'unresolved', text: 'Aurora' }, to: { kind: 'unresolved', text: 'Streetworks & Permits' }, attributes: { role: 'secondary' } },
    ]);
    expect(candidates.map((c) => c.seq)).toEqual([0, 1, 2]);
  });

  it('a supports row with no Role defaults to secondary (K-13) at a lower confidence; a Role that is neither primary nor secondary is skipped, counted', () => {
    const { candidates, skipped } = run(['From', 'Type', 'To', 'Role'], [['A', 'supports', 'Cap', ''], ['B', 'supports', 'Cap', 'tertiary']]);
    expect(candidates).toHaveLength(1);
    expect((candidates[0]?.proposal as RelationshipProposal<'supports'>).attributes).toEqual({ role: 'secondary' });
    expect(candidates[0]?.evidence.attributeConfidence.role).toBeLessThan(1);
    expect(skipped).toEqual([{ rowNumber: 3, reason: 'INVALID_ROLE' }]);
  });

  it('owns rows are not read (the Owner column of an element sheet is the owner path) and are counted as unsupported', () => {
    const { candidates, skipped } = run(['From', 'Type', 'To', 'Verb', 'Role'], [['Network Team', 'owns', 'ArcGIS', '', 'business']]);
    expect(candidates).toHaveLength(0);
    expect(skipped).toEqual([{ rowNumber: 2, reason: 'UNSUPPORTED_TYPE' }]);
  });

  it('a wholly blank row is not a skip', () => {
    expect(run(['From', 'Type', 'To', 'Verb'], [['', '', '', '']])).toEqual({ candidates: [], skipped: [] });
  });

  it("reads the export's Via and Data classification columns: via becomes a hint, and the classification is read by key, spaced key or label", () => {
    const { candidates, skipped } = run(
      ['From', 'Type', 'To', 'Verb', 'Role', 'Via', 'Data classification'],
      [
        ['ESCOMS', 'flows_to', 'Aurora', 'sends work to', '', 'MuleSoft', 'official_sensitive'],
        ['ESCOMS', 'flows_to', 'CBRM', 'sends condition to', '', '', 'Official Sensitive'],
        ['ESCOMS', 'uses', 'CBRM', 'reads from', '', 'MuleSoft', ''],
      ],
    );
    expect(skipped).toEqual([]);
    expect(candidates.map((c) => c.viaHint)).toEqual(['MuleSoft', undefined, 'MuleSoft']);
    expect(candidates.map((c) => (c.proposal.attributes as Record<string, unknown>).dataClassification)).toEqual(['official_sensitive', 'official_sensitive', undefined]);
  });

  it('drops a data classification it cannot read, with a warning, and keeps the flow', () => {
    const { candidates } = run(['From', 'Type', 'To', 'Verb', 'Data classification'], [['A', 'flows_to', 'B', 'sends to', 'top secret']]);
    expect(candidates).toHaveLength(1);
    expect((candidates[0]?.proposal.attributes as Record<string, unknown>).dataClassification).toBeUndefined();
    expect(candidates[0]?.evidence.warnings).toEqual([{ code: 'ENUM_UNPARSED', cell: 'E2', raw: 'top secret' }]);
  });
});
