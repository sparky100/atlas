import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS } from './importRowSchema';
import { RELATIONSHIP_IMPORT_COLUMNS } from './importRelationshipRow';
import { lookupColumnSynonym } from './columnSynonyms';
import { isRelationshipsSheet } from './relationshipSheetToCandidates';
import { RELATIONSHIP_COLUMN_HEADINGS, SYSTEM_COLUMN_HEADINGS, buildImportTemplateSheets } from './importTemplate';

describe('import template', () => {
  it('has a heading for every column the importer reads, and none extra', () => {
    expect(Object.keys(SYSTEM_COLUMN_HEADINGS).sort()).toEqual([...IMPORT_COLUMNS].sort());
    expect(Object.keys(RELATIONSHIP_COLUMN_HEADINGS).sort()).toEqual([...RELATIONSHIP_IMPORT_COLUMNS].sort());
  });

  it('writes only systems headings the importer recognises without an AI guess', () => {
    for (const heading of Object.values(SYSTEM_COLUMN_HEADINGS)) {
      expect(lookupColumnSynonym(heading), heading).not.toBeNull();
    }
  });

  it('maps each systems heading to the role of its own column', () => {
    expect(lookupColumnSynonym(SYSTEM_COLUMN_HEADINGS.platform)).toBe('parent');
    expect(lookupColumnSynonym(SYSTEM_COLUMN_HEADINGS.is_external)).toBe('isExternal');
    expect(lookupColumnSynonym(SYSTEM_COLUMN_HEADINGS.lifecycle)).toBe('lifecycleStatus');
    expect(lookupColumnSynonym(SYSTEM_COLUMN_HEADINGS.name)).toBe('name');
  });

  it('is read as a relationships sheet', () => {
    const sheets = buildImportTemplateSheets();
    const rel = sheets.find((s) => s.name === 'Relationships');
    expect(rel?.cells[0]).toBeDefined();
    expect(isRelationshipsSheet('Relationships', rel?.cells[0] ?? [])).toBe(true);
    expect(isRelationshipsSheet('Sheet1', rel?.cells[0] ?? [])).toBe(true);
  });

  it('is deterministic, has aligned rows, and marks every example', () => {
    expect(buildImportTemplateSheets()).toEqual(buildImportTemplateSheets());
    for (const sheet of buildImportTemplateSheets().filter((s) => s.name !== 'Read me first')) {
      const width = sheet.cells[0]?.length ?? 0;
      for (const row of sheet.cells) expect(row).toHaveLength(width);
      for (const row of sheet.cells.slice(1)) expect(row[0] ?? '').toMatch(/^EXAMPLE /);
    }
  });
});
