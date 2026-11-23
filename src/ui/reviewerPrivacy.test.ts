import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reviewer names are audit metadata. No reader view, export or pack may read
 * the field; only the platform-admin editor may store it. This is a cheap
 * source guard on top of the explicit export test.
 */
const READER_FILES = [
  'decisions/OptionSources.tsx',
  'decisions/DecisionView.tsx',
  'decisions/exportDecisionAsAdr.ts',
  'decisions/packDocument.ts',
  'decisions/PackDocumentView.tsx',
  'decisions/DecisionPacks.tsx',
  'elements/CapabilityProducts.tsx',
  'admin/CatalogueVersionAdmin.tsx',
];

describe('reviewer metadata stays internal', () => {
  it('no reader view, export or pack reads a reviewer field', () => {
    const offenders = READER_FILES.filter((file) => /reviewedBy|reviewed_by/.test(readFileSync(join(__dirname, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
