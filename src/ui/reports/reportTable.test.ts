import { describe, expect, it } from 'vitest';
import type { ReportResult } from '../../engine/reportQuery';
import { reportCellText, reportFieldLabel, resultToTable, tableToCsv } from './reportTable';

const base: ReportResult = { columns: ['name', 'costCentre'], rows: [['Billing', 'A1'], ['CRM', null]], rowCount: 2, truncated: false, groups: [], unknownFields: [] };

describe('resultToTable', () => {
  it('labels known fields, keeps custom keys, blanks null', () => {
    expect(resultToTable(base)).toEqual([['Name', 'costCentre'], ['Billing', 'A1'], ['CRM', '']]);
  });
  it('says when an attribute has been removed', () => {
    expect(resultToTable({ ...base, unknownFields: ['costCentre'] })[0]).toEqual(['Name', 'costCentre (attribute removed)']);
  });
  it('writes groups as value and count', () => {
    const grouped: ReportResult = { columns: ['name'], rows: [], rowCount: 3, truncated: false, groups: [{ value: 'active', count: 2 }, { value: null, count: 1 }], unknownFields: [] };
    expect(resultToTable(grouped, { field: 'lifecycle' })).toEqual([['Lifecycle', 'Count'], ['active', '2'], ['', '1']]);
  });
  it('writes a count result as one number', () => {
    expect(resultToTable({ columns: ['name'], rows: [], rowCount: 7, truncated: false, groups: [], unknownFields: [] })).toEqual([['Rows'], ['7']]);
  });
  it('formats booleans and labels', () => {
    expect(reportCellText(true)).toBe('Yes');
    expect(reportCellText(0)).toBe('0');
    expect(reportFieldLabel('cost')).toBe('Run cost');
  });
});

describe('tableToCsv', () => {
  it('quotes commas, quotes and newlines, uses CRLF', () => {
    expect(tableToCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\r\n"say ""hi""","x\ny"\r\n');
  });
  it('defuses spreadsheet formulas', () => {
    expect(tableToCsv([['=SUM(A1)', '-5', 'ok']])).toBe("'=SUM(A1),'-5,ok\r\n");
  });
});
