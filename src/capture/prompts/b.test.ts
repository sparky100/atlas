import { describe, expect, it } from 'vitest';
import { buildPromptBUserMessage, PROMPT_B_ELEMENT_TYPES, PROMPT_B_SCHEMA, PROMPT_B_SYSTEM } from './b';

describe('PROMPT_B_SYSTEM', () => {
  it('never mentions the removed component element type', () => {
    expect(PROMPT_B_SYSTEM).not.toMatch(/\bcomponent\b/i);
  });

  it('lists the four current element types and no relationship endpoint pair involving component', () => {
    expect(PROMPT_B_ELEMENT_TYPES).toEqual(['capability', 'system', 'container', 'actor']);
    expect(PROMPT_B_SYSTEM).toContain('uses: system|container → system|container');
  });

  it("states the evidence rule that a passage not found in the document is discarded", () => {
    expect(PROMPT_B_SYSTEM).toContain('discards');
  });
});

describe('PROMPT_B_SCHEMA', () => {
  it('is strict with elements and relationships both required', () => {
    expect(PROMPT_B_SCHEMA.additionalProperties).toBe(false);
    expect(PROMPT_B_SCHEMA.required).toEqual(['elements', 'relationships']);
  });

  it('every element requires namePassage/nameConfidence/parentName per §6.2', () => {
    expect(PROMPT_B_SCHEMA.properties.elements.items.required).toEqual(['elementType', 'name', 'namePassage', 'nameConfidence', 'parentName', 'attributes']);
  });

  it('attribute values are string or boolean, never a bare object', () => {
    const attrSchema = PROMPT_B_SCHEMA.properties.elements.items.properties.attributes.items.properties.value;
    expect(attrSchema).toEqual({ anyOf: [{ type: 'string' }, { type: 'boolean' }] });
  });
});

describe('buildPromptBUserMessage', () => {
  it('renders a page-range chunk with prior element names', () => {
    const message = buildPromptBUserMessage({
      inputName: 'Catalogue.pdf',
      location: { kind: 'pages', first: 2, last: 7, total: 9 },
      priorElementNames: ['CRM', 'Data Warehouse'],
      chunkText: 'The CRM sends nightly extracts to the data warehouse.',
    });
    expect(message).toContain('Document: Catalogue.pdf');
    expect(message).toContain('Pages 2–7 of 9.');
    expect(message).toContain('CRM, Data Warehouse');
    expect(message).toContain('--- BEGIN TEXT ---');
    expect(message).toContain('The CRM sends nightly extracts');
    expect(message).toContain('--- END TEXT ---');
  });

  it('renders a pasted-text chunk and omits the prior-elements line on the first chunk', () => {
    const message = buildPromptBUserMessage({
      inputName: 'Pasted notes',
      location: { kind: 'pastedText', start: 0, end: 500, total: 1800 },
      chunkText: 'Some notes.',
    });
    expect(message).toContain('Pasted text, characters 0–500 of 1800.');
    expect(message).not.toContain('Elements already found');
  });
});
