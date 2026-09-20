import type { EvidenceWarning } from '../../contracts/capture';

/** Short chip text per warning code (SPEC-capture.md §10's own examples: "date assumed dd/mm", `status "Live" read as active`, "column mapped by AI 0.72"). */
export function evidenceWarningLabel(warning: EvidenceWarning): string {
  switch (warning.code) {
    case 'MERGED_CELL':
      return `merged cell ${warning.cell}`;
    case 'FORMULA_ERROR':
      return `formula error in ${warning.cell}`;
    case 'AMBIGUOUS_DATE':
      return `date assumed ${warning.parsedAs}`;
    case 'ENUM_FUZZY':
      return `"${warning.raw}" read as ${warning.parsedAs}`;
    case 'PASSAGE_NORMALISED':
      return 'passage matched after normalising whitespace/quotes';
    case 'MULTI_VALUE_CELL':
      return `multiple values in ${warning.cell}`;
    case 'LOW_MAPPING_CONFIDENCE':
      return `column "${warning.column}" mapped by AI ${warning.confidence.toFixed(2)}`;
    case 'ROWS_DISAGREE':
      return `rows disagree on ${warning.cell}`;
    case 'ENUM_UNPARSED':
      return `"${warning.raw}" not recognised`;
    case 'PARENT_UNRESOLVED':
      return `parent "${warning.text}" not found`;
    case 'ENDPOINT_UNRESOLVED':
      return `${warning.end} "${warning.text}" not found`;
    case 'PASSAGE_NOT_FOUND':
      return `no passage found for ${warning.field}`;
    case 'UNKNOWN_ATTRIBUTE_KEY':
      return `unknown attribute "${warning.key}"`;
  }
}
