import { describe, expect, it } from 'vitest';
import type { EvidenceWarning } from '../../contracts/capture';
import { evidenceWarningLabel } from './evidenceWarningLabel';

describe('evidenceWarningLabel', () => {
  it('renders every warning code (SPEC-capture.md §10\'s own examples)', () => {
    const cases: [EvidenceWarning, string][] = [
      [{ code: 'MERGED_CELL', cell: 'B4' }, 'merged cell B4'],
      [{ code: 'FORMULA_ERROR', cell: 'C2' }, 'formula error in C2'],
      [{ code: 'AMBIGUOUS_DATE', cell: 'D5', parsedAs: 'dd/mm' }, 'date assumed dd/mm'],
      [{ code: 'ENUM_FUZZY', cell: 'E1', raw: 'Live', parsedAs: 'active' }, '"Live" read as active'],
      [{ code: 'PASSAGE_NORMALISED' }, 'passage matched after normalising whitespace/quotes'],
      [{ code: 'MULTI_VALUE_CELL', cell: 'F3' }, 'multiple values in F3'],
      [{ code: 'LOW_MAPPING_CONFIDENCE', column: 'Service area', confidence: 0.72 }, 'column "Service area" mapped by AI 0.72'],
      [{ code: 'ROWS_DISAGREE', cell: 'G1' }, 'rows disagree on G1'],
      [{ code: 'ENUM_UNPARSED', cell: 'H2', raw: 'Kinda active' }, '"Kinda active" not recognised'],
      [{ code: 'PARENT_UNRESOLVED', text: 'Housing Platform' }, 'parent "Housing Platform" not found'],
      [{ code: 'ENDPOINT_UNRESOLVED', text: 'CRM', end: 'to' }, 'to "CRM" not found'],
      [{ code: 'PASSAGE_NOT_FOUND', field: 'vendor' }, 'no passage found for vendor'],
      [{ code: 'UNKNOWN_ATTRIBUTE_KEY', key: 'colour' }, 'unknown attribute "colour"'],
    ];
    for (const [warning, expected] of cases) expect(evidenceWarningLabel(warning)).toBe(expected);
  });
});
