import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPORT_SOURCE, IMPORT_SOURCES, importSourceById } from './importSources';

describe('IMPORT_SOURCES', () => {
  it('has unique ids and a title, summary and intro for each', () => {
    expect(new Set(IMPORT_SOURCES.map((source) => source.id)).size).toBe(IMPORT_SOURCES.length);
    for (const source of IMPORT_SOURCES) {
      expect(source.title.trim()).not.toBe('');
      expect(source.summary.trim()).not.toBe('');
      expect(source.intro.trim()).not.toBe('');
    }
  });

  it('starts with the documents source, which is the default', () => {
    expect(IMPORT_SOURCES[0]?.id).toBe('documents');
    expect(DEFAULT_IMPORT_SOURCE).toBe('documents');
  });

  it('gives every tool export a guide, and the documents source none', () => {
    for (const source of IMPORT_SOURCES) {
      if (source.group === 'tool-export') expect(source.exportSteps.length).toBeGreaterThan(0);
      else expect(source.exportSteps).toEqual([]);
    }
  });

  it('finds a source by id and refuses an unknown one', () => {
    expect(importSourceById('mulesoft').title).toBe('MuleSoft Anypoint');
    expect(() => importSourceById('nope' as never)).toThrow('Unknown import source');
  });
});
