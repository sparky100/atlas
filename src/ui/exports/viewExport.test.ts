import { describe, expect, it } from 'vitest';
import { exportDate, exportFilename, stampRefLabel, stampShapes, truncate, type ExportShape } from './viewExport';

const STAMP = { modelName: 'Acme Housing', viewLabel: 'Capability map, coloured by Criticality', refLabel: 'Main', date: '2026-10-02' };

function texts(shapes: readonly ExportShape[]): string[] {
  return shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
}

describe('viewExport (F13 step 1)', () => {
  it('stampShapes: names the view and model, then the state shown and the date', () => {
    expect(texts(stampShapes(STAMP, 800))).toEqual(['Capability map, coloured by Criticality — Acme Housing', 'Main · exported 2026-10-02 from Atlas']);
  });

  it('truncate: leaves short text alone and cuts long text to the budget with an ellipsis', () => {
    expect(truncate('Finance', 10)).toBe('Finance');
    expect(truncate('Customer relationship management', 10)).toBe('Customer …');
    expect(truncate('Customer relationship management', 10)).toHaveLength(10);
  });

  it('exportFilename: model, view and date, safe on every OS', () => {
    expect(exportFilename(STAMP, 'png')).toBe('acme-housing-capability-map-coloured-by-criticality-2026-10-02.png');
    expect(exportFilename({ ...STAMP, modelName: '///', viewLabel: 'Portfolio' }, 'pdf')).toBe('export-portfolio-2026-10-02.pdf');
  });

  it('stampRefLabel: main, a version, a change by its name, or a commit', () => {
    expect(stampRefLabel({ kind: 'main' })).toBe('Live model');
    expect(stampRefLabel({ kind: 'tag', name: 'v2026-Q1' })).toBe('Version v2026-Q1');
    expect(stampRefLabel({ kind: 'branch', branchId: 'b1234567-0000' }, 'Housing CRM')).toBe('Change: Housing CRM');
    expect(stampRefLabel({ kind: 'branch', branchId: 'b1234567-0000' })).toBe('Change: b1234567');
    expect(stampRefLabel({ kind: 'commit', commitId: 'c7654321-0000' })).toBe('Commit c7654321');
  });

  it('exportDate: the given instant as YYYY-MM-DD', () => {
    expect(exportDate(new Date('2026-10-02T23:10:00Z'))).toBe('2026-10-02');
  });
});
