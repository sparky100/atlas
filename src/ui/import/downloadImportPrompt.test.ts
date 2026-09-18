import { describe, expect, it } from 'vitest';
import { renderImportPrompt } from './downloadImportPrompt';

describe('renderImportPrompt', () => {
  it('serves the JSON-oriented prompt: one JSON file, systems/relationships/changes as top-level keys, never CSV', () => {
    const rendered = renderImportPrompt([]);
    expect(rendered.toLowerCase()).toContain('one json file');
    expect(rendered).toContain('`systems`');
    expect(rendered).toContain('`relationships`');
    expect(rendered).toContain('`changes`');
    expect(rendered).not.toContain('CSV');
    expect(rendered).not.toContain('systems.csv');
  });

  it('documents quote/confidence as required on every entry', () => {
    const rendered = renderImportPrompt([]);
    expect(rendered).toContain('quote');
    expect(rendered).toContain('confidence');
  });

  it('documents replaced_by on the changes section', () => {
    const rendered = renderImportPrompt([]);
    expect(rendered).toContain('replaced_by');
  });

  it('substitutes the capability list placeholder, leaving no literal marker behind', () => {
    const rendered = renderImportPrompt([]);
    expect(rendered).not.toContain('{{SCHEMA}}');
    expect(rendered).not.toContain('{{CAPABILITY_LIST}}');
  });
});
