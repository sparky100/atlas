import { describe, expect, it } from 'vitest';
import { buildPromptAUserMessage, PROMPT_A_COLUMN_ROLES, PROMPT_A_SCHEMA, PROMPT_A_SHEET_TYPES, PROMPT_A_SYSTEM } from './a';

describe('PROMPT_A_SYSTEM', () => {
  it('never mentions the removed component element type (ADR-000 S1 item 18)', () => {
    expect(PROMPT_A_SYSTEM).not.toMatch(/\bcomponent\b/i);
  });

  it('names exactly the four current element types', () => {
    expect(PROMPT_A_SYSTEM).toContain('four element types: capability, system, container, actor');
  });

  it('lists every column role the schema itself accepts', () => {
    for (const role of PROMPT_A_COLUMN_ROLES) expect(PROMPT_A_SYSTEM).toContain(role);
  });
});

describe('PROMPT_A_SCHEMA', () => {
  it('is a strict, fully-required object schema', () => {
    expect(PROMPT_A_SCHEMA.additionalProperties).toBe(false);
    expect(PROMPT_A_SCHEMA.required).toEqual(['sheetType', 'columns']);
    expect(PROMPT_A_SCHEMA.properties.columns.items.additionalProperties).toBe(false);
    expect(PROMPT_A_SCHEMA.properties.columns.items.required).toEqual(['column', 'role', 'confidence', 'reason']);
  });

  it("has no component in the sheetType enum, matching the four-type taxonomy", () => {
    expect(PROMPT_A_SHEET_TYPES).not.toContain('component');
    expect(PROMPT_A_SCHEMA.properties.sheetType.enum).toEqual([...PROMPT_A_SHEET_TYPES]);
  });
});

describe('buildPromptAUserMessage', () => {
  it('renders the §6.1 template shape', () => {
    const message = buildPromptAUserMessage({
      inputName: 'Applications 2026-Q3.xlsx',
      sheetName: 'Applications',
      rowCount: 12,
      mappedHeaders: [{ header: 'Application', role: 'name' }],
      unmappedHeaders: [{ columnRef: 'C', header: 'Status' }],
      sampleRows: [['Active'], ['Retired']],
    });
    expect(message).toContain('Workbook: Applications 2026-Q3.xlsx');
    expect(message).toContain('Sheet: Applications (12 data rows)');
    expect(message).toContain('Application → name');
    expect(message).toContain('column C: Status');
    expect(message).toContain('Active');
  });

  it('caps sample rows at 5 and marks empty sections as none', () => {
    const message = buildPromptAUserMessage({
      inputName: 'x.csv',
      sheetName: 'Sheet1',
      rowCount: 10,
      mappedHeaders: [],
      unmappedHeaders: [{ columnRef: 'A', header: 'Name' }],
      sampleRows: [['1'], ['2'], ['3'], ['4'], ['5'], ['6']],
    });
    expect(message).toContain('(none)');
    expect(message).not.toContain('6');
  });
});
