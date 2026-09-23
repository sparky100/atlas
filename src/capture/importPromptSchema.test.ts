import { describe, expect, it } from 'vitest';
import { buildImportPromptSchema } from './importPromptSchema';

describe('buildImportPromptSchema', () => {
  it('names every real Systems-sheet column, so the prompt can never drift from the actual importer', () => {
    const schema = buildImportPromptSchema();
    for (const column of ['name', 'description', 'kind', 'lifecycle', 'criticality', 'domain', 'hosting_model', 'vendor', 'is_external', 'external_organisation', 'platform', 'capability', 'business_owner', 'technical_owner']) {
      expect(schema).toContain(column);
    }
  });

  it('names every real Relationships-sheet column', () => {
    const schema = buildImportPromptSchema();
    for (const column of ['from', 'type', 'to', 'description', 'via', 'data_classification']) {
      expect(schema).toContain(column);
    }
  });

  it('documents the owner external syntax and the capability pipe-list rule', () => {
    const schema = buildImportPromptSchema();
    expect(schema).toContain('External:');
    expect(schema).toContain('|');
  });

  it('names every real changes-section field, including replaced_by', () => {
    const schema = buildImportPromptSchema();
    for (const column of ['name', 'action', 'reason', 'replaced_by']) {
      expect(schema).toContain(column);
    }
    expect(schema).toContain('retire');
    expect(schema).toContain('restore');
  });

  it('documents quote/confidence as applying to every entry, in all three arrays', () => {
    const schema = buildImportPromptSchema();
    expect(schema).toContain('quote');
    expect(schema).toContain('confidence');
  });

  it('describes the real JSON shape, never CSV', () => {
    const schema = buildImportPromptSchema();
    expect(schema).toContain('systems');
    expect(schema).toContain('relationships');
    expect(schema).toContain('changes');
    expect(schema).not.toContain('CSV');
  });

  it('does not document a value_streams section (Sprint F2b — dropped from capture, per ADR-023)', () => {
    const schema = buildImportPromptSchema();
    expect(schema).not.toContain('value_streams');
    expect(schema).toContain('never part of this file');
  });
});
