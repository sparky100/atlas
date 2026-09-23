/**
 * Sprint F2b, SPEC-capture.md §5.2a: a dedicated "Relationships" sheet —
 * one row per `uses`/`flows_to` edge, folded in from F2-lite's own
 * `importRelationshipRow.ts`. Deterministic, code only, no LLM call: the
 * six columns are fixed, unlike an element sheet's own synonym/prompt-A
 * column mapping (§5.2) — this sheet is detected and parsed *before*
 * `mapColumns.ts` ever sees it.
 *
 * Produces the same `RowCandidate` shape `rowsToCandidates.ts` already
 * emits for an inline `usesSystems`/`flowsTo` cell — unresolved `from`/`to`
 * refs, an optional `viaHint` — so `runCapture.ts`'s existing
 * endpoint-resolution machinery (`resolveRelationshipCandidate`/
 * `resolveEndpointRef`) needs no change to consume them; both coexist,
 * inline columns on an ordinary element sheet are untouched.
 */
import type { CandidateEvidence, RelationshipProposal } from '../contracts/capture';
import type { SourceRef } from '../contracts/sourceRef';
import { extractDataRows, type RawSheet } from './parse/sheetGrid';
import type { RowCandidate } from './rowsToCandidates';

/** §5.2a: a sheet is a Relationships sheet by name first. */
export const RELATIONSHIPS_SHEET_NAME_PATTERN = /\b(relationships?|integrations?)\b/i;
const REQUIRED_HEADERS = ['from', 'type', 'to'];

/** §5.2a: name match first; failing that, the header row must at minimum carry `from`/`type`/`to` (case-insensitive) unambiguously — no element-sheet column role ever maps a header to `type`, so a real element sheet is never mistaken for this. */
export function isRelationshipsSheet(sheetName: string, headers: readonly string[]): boolean {
  if (RELATIONSHIPS_SHEET_NAME_PATTERN.test(sheetName)) return true;
  const normalised = new Set(headers.map((h) => h.trim().toLowerCase()));
  return REQUIRED_HEADERS.every((h) => normalised.has(h));
}

export interface RelationshipsSheetInput {
  sheetName: string;
  headers: readonly string[];
  headerColumnRefs: readonly string[];
  rawSheet: RawSheet;
  headerRowIndex: number;
}

function colIndex(headers: readonly string[], name: string): number {
  return headers.findIndex((h) => h.trim().toLowerCase() === name);
}

function rowRangeRef(sheetName: string, headerColumnRefs: readonly string[], rowNumber: number): SourceRef {
  const first = headerColumnRefs[0] ?? '?';
  const last = headerColumnRefs[headerColumnRefs.length - 1] ?? first;
  return { kind: 'sheet', sheet: sheetName, range: `${first}${String(rowNumber)}:${last}${String(rowNumber)}` };
}

/**
 * §5.2a: row → candidate, code only. `from`/`to` blank, or `type` not
 * `uses`/`flows_to`, or `description` blank (`required: true` at the
 * UI-form level, `relationshipAttributeSchema.ts` — there is no "invalid
 * because a required attribute is missing" path for a relationship
 * candidate the way an element has `PARENT_UNRESOLVED`) all produce **no
 * candidate at all** for that row, the same silent-skip an entirely
 * blank row already gets elsewhere in this pipeline. `data_classification`
 * on a `uses` row is dropped (`UsesAttributes` has no such key).
 */
export function relationshipSheetToCandidates(input: RelationshipsSheetInput): RowCandidate[] {
  const { sheetName, headers, headerColumnRefs, rawSheet, headerRowIndex } = input;
  const fromCol = colIndex(headers, 'from');
  const typeCol = colIndex(headers, 'type');
  const toCol = colIndex(headers, 'to');
  const descriptionCol = colIndex(headers, 'description');
  const viaCol = colIndex(headers, 'via');
  const dataClassificationCol = colIndex(headers, 'data_classification');
  if (fromCol < 0 || typeCol < 0 || toCol < 0) return [];

  const dataRows = extractDataRows(rawSheet, headerRowIndex, fromCol);
  const candidates: RowCandidate[] = [];
  let seq = 0;

  for (const row of dataRows) {
    const from = (row.cells[fromCol] ?? '').trim();
    const typeRaw = (row.cells[typeCol] ?? '').trim();
    const to = (row.cells[toCol] ?? '').trim();
    const description = descriptionCol >= 0 ? (row.cells[descriptionCol] ?? '').trim() : '';
    if (from === '' || to === '' || description === '' || (typeRaw !== 'uses' && typeRaw !== 'flows_to')) continue;

    const via = viaCol >= 0 ? (row.cells[viaCol] ?? '').trim() || undefined : undefined;
    const dataClassification = typeRaw === 'flows_to' && dataClassificationCol >= 0 ? (row.cells[dataClassificationCol] ?? '').trim() || undefined : undefined;

    const proposal: RelationshipProposal<'uses' | 'flows_to'> = {
      kind: 'relationship',
      relationshipType: typeRaw,
      from: { kind: 'unresolved', text: from },
      to: { kind: 'unresolved', text: to },
      attributes: { description, ...(dataClassification !== undefined ? { dataClassification } : {}) },
    };
    const evidence: CandidateEvidence = {
      sourceRef: rowRangeRef(sheetName, headerColumnRefs, row.rowNumber),
      passage: [...headers, ...row.cells].join(' | '),
      extractor: 'sheet-mapping',
      attributeConfidence: { description: 1, ...(dataClassification !== undefined ? { dataClassification: 1 } : {}) },
      warnings: [],
    };
    candidates.push({ seq: seq++, proposal, evidence, ...(via !== undefined ? { viaHint: via } : {}), aliasProposals: [] });
  }

  return candidates;
}
