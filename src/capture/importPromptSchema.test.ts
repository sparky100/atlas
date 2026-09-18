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
});
