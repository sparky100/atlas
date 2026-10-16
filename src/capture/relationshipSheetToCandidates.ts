/**
 * Sprint F2b, SPEC-capture.md §5.2a: a dedicated "Relationships" sheet —
 * one row per `uses`/`flows_to` edge, folded in from F2-lite's own
 * `importRelationshipRow.ts`. Deterministic, code only, no LLM call: the
 * columns are fixed, unlike an element sheet's own synonym/prompt-A
 * column mapping (§5.2) — this sheet is detected and parsed *before*
 * `mapColumns.ts` ever sees it.
 *
 * **Amended 2026-10-08 (this product's own export round trip):** the export
 * writes `From, Type, To, Verb, Role` and puts `supports` edges on the same
 * sheet, so a re-import (a) reads `Verb` as the description column and (b)
 * accepts `supports` rows, whose `Role` (`primary`/`secondary`, blank →
 * `secondary`, the K-13 default `capabilityAssignment.ts` also uses) is the
 * edge's own attribute. Before this, every row of an exported workbook was
 * dropped: `supports` was never an accepted type, and the verb column the
 * importer looked for was named something else. `owns` rows are still not
 * read here — the owner comes from an element sheet's `Owner` column, and
 * reading both would propose the same `owns` edge twice.
 *
 * Produces the same `RowCandidate` shape `rowsToCandidates.ts` already
 * emits for an inline `usesSystems`/`flowsTo` cell — unresolved `from`/`to`
 * refs, an optional `viaHint` — so `runCapture.ts`'s existing
 * endpoint-resolution machinery (`resolveRelationshipCandidate`/
 * `resolveEndpointRef`) needs no change to consume them; both coexist,
 * inline columns on an ordinary element sheet are untouched.
 */
import type { CandidateEvidence, EvidenceWarning, RelationshipProposal } from '../contracts/capture';
import { relationshipAttributeFieldSchema, validateRelationshipAttributeValue } from '../contracts/relationshipAttributeSchema';
import type { SourceRef } from '../contracts/sourceRef';
import { extractDataRows, type RawSheet } from './parse/sheetGrid';
import { DEFAULTED_ATTRIBUTE_CONFIDENCE } from './confidence';
import type { RowCandidate } from './rowsToCandidates';

/** §5.2a: a sheet is a Relationships sheet by name first. */
export const RELATIONSHIPS_SHEET_NAME_PATTERN = /\b(relationships?|integrations?)\b/i;
const REQUIRED_HEADERS = ['from', 'type', 'to'];

/** The relationship types this sheet is read for. */
const SHEET_RELATIONSHIP_TYPES = ['uses', 'flows_to', 'supports'] as const;
type SheetRelationshipType = (typeof SHEET_RELATIONSHIP_TYPES)[number];
function isSheetRelationshipType(value: string): value is SheetRelationshipType {
  return (SHEET_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

/** Why a row with something in it produced no candidate — counted into the job's own `stats` (`relationships.skipped.<reason>`); a wholly blank row isn't a skip. */
export type RelationshipRowSkipReason = 'MISSING_ENDPOINT' | 'UNSUPPORTED_TYPE' | 'MISSING_DESCRIPTION' | 'INVALID_ROLE';

export interface RelationshipSheetResult {
  candidates: RowCandidate[];
  skipped: { rowNumber: number; reason: RelationshipRowSkipReason }[];
}

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

/** An enum cell read by key, spaced key or label; `undefined` when it is none of them. */
function parseRelationshipEnum(relationshipType: 'uses' | 'flows_to', key: 'dataClassification' | 'protocolIn' | 'protocolOut', raw: string): string | undefined {
  const field = relationshipAttributeFieldSchema(relationshipType, key);
  const wanted = raw.trim().toLowerCase();
  const options = field?.options ?? [];
  const option = options.find((o) => o === wanted) ?? options.find((o) => o === wanted.replace(/[\s-]+/g, '_')) ?? options.find((o) => (field?.optionLabels?.[o] ?? '').toLowerCase() === wanted);
  if (option === undefined) return undefined;
  const validated = validateRelationshipAttributeValue(relationshipType, key, option);
  return validated.ok && typeof validated.value === 'string' ? validated.value : undefined;
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
 * §5.2a: row → candidate, code only. `from`/`to` blank, a `type` this sheet
 * isn't read for, or (`uses`/`flows_to`) a blank verb all produce **no
 * candidate at all** for that row — SPEC §5.2a's own silent skip, now
 * *counted* (`skipped`) so a job's stats say how many rows an import left
 * out and why. `data_classification` on a `uses` row is dropped
 * (`UsesAttributes` has no such key).
 */
export function relationshipSheetToCandidates(input: RelationshipsSheetInput): RelationshipSheetResult {
  const { sheetName, headers, headerColumnRefs, rawSheet, headerRowIndex } = input;
  const fromCol = colIndex(headers, 'from');
  const typeCol = colIndex(headers, 'type');
  const toCol = colIndex(headers, 'to');
  // This product's own export names the verb column "Verb"; F2-lite's JSON
  // format (and the documented sheet) calls it "description".
  const descriptionCol = colIndex(headers, 'description') >= 0 ? colIndex(headers, 'description') : colIndex(headers, 'verb');
  const roleCol = colIndex(headers, 'role');
  const viaCol = colIndex(headers, 'via');
  // The export's header is "Data classification"; the JSON/documented form is `data_classification`.
  const dataClassificationCol = colIndex(headers, 'data classification') >= 0 ? colIndex(headers, 'data classification') : colIndex(headers, 'data_classification');
  // ADR-026: each side's protocol on a flow through a platform.
  const protocolInCol = colIndex(headers, 'protocol in') >= 0 ? colIndex(headers, 'protocol in') : colIndex(headers, 'protocol_in');
  const protocolOutCol = colIndex(headers, 'protocol out') >= 0 ? colIndex(headers, 'protocol out') : colIndex(headers, 'protocol_out');
  if (fromCol < 0 || typeCol < 0 || toCol < 0) return { candidates: [], skipped: [] };

  const dataRows = extractDataRows(rawSheet, headerRowIndex, fromCol);
  const candidates: RowCandidate[] = [];
  const skipped: RelationshipSheetResult['skipped'] = [];
  let seq = 0;

  for (const row of dataRows) {
    const from = (row.cells[fromCol] ?? '').trim();
    const typeRaw = (row.cells[typeCol] ?? '').trim();
    const to = (row.cells[toCol] ?? '').trim();
    const description = descriptionCol >= 0 ? (row.cells[descriptionCol] ?? '').trim() : '';
    if (from === '' && to === '' && typeRaw === '') continue;
    if (from === '' || to === '') {
      skipped.push({ rowNumber: row.rowNumber, reason: 'MISSING_ENDPOINT' });
      continue;
    }
    if (!isSheetRelationshipType(typeRaw)) {
      skipped.push({ rowNumber: row.rowNumber, reason: 'UNSUPPORTED_TYPE' });
      continue;
    }

    const evidence = (attributeConfidence: Record<string, number>, warnings: EvidenceWarning[] = []): CandidateEvidence => ({
      sourceRef: rowRangeRef(sheetName, headerColumnRefs, row.rowNumber),
      passage: [...headers, ...row.cells].join(' | '),
      extractor: 'sheet-mapping',
      attributeConfidence,
      warnings,
    });

    if (typeRaw === 'supports') {
      const roleRaw = roleCol >= 0 ? (row.cells[roleCol] ?? '').trim().toLowerCase() : '';
      const role = roleRaw === '' ? 'secondary' : roleRaw;
      if (role !== 'primary' && role !== 'secondary') {
        skipped.push({ rowNumber: row.rowNumber, reason: 'INVALID_ROLE' });
        continue;
      }
      const proposal: RelationshipProposal<'supports'> = { kind: 'relationship', relationshipType: 'supports', from: { kind: 'unresolved', text: from }, to: { kind: 'unresolved', text: to }, attributes: { role } };
      candidates.push({ seq: seq++, proposal, evidence: evidence({ role: roleRaw === '' ? DEFAULTED_ATTRIBUTE_CONFIDENCE : 1 }), aliasProposals: [] });
      continue;
    }

    if (description === '') {
      skipped.push({ rowNumber: row.rowNumber, reason: 'MISSING_DESCRIPTION' });
      continue;
    }
    const via = viaCol >= 0 ? (row.cells[viaCol] ?? '').trim() || undefined : undefined;
    // Read by key, spaced key or label like every other enum cell; a value that is none of them is dropped with a warning, never guessed.
    const warnings: EvidenceWarning[] = [];
    const enumAttributes: Record<string, string> = {};
    const readEnum = (key: 'dataClassification' | 'protocolIn' | 'protocolOut', col: number): void => {
      const raw = col >= 0 ? (row.cells[col] ?? '').trim() : '';
      if (raw === '') return;
      const value = parseRelationshipEnum(typeRaw, key, raw);
      if (value === undefined) warnings.push({ code: 'ENUM_UNPARSED', cell: `${headerColumnRefs[col] ?? '?'}${String(row.rowNumber)}`, raw });
      else enumAttributes[key] = value;
    };
    // `data_classification` on a `uses` row is dropped (`UsesAttributes` has no such key).
    if (typeRaw === 'flows_to') readEnum('dataClassification', dataClassificationCol);
    readEnum('protocolIn', protocolInCol);
    readEnum('protocolOut', protocolOutCol);

    const proposal: RelationshipProposal<'uses' | 'flows_to'> = {
      kind: 'relationship',
      relationshipType: typeRaw,
      from: { kind: 'unresolved', text: from },
      to: { kind: 'unresolved', text: to },
      attributes: { description, ...enumAttributes },
    };
    const enumConfidence = Object.fromEntries(Object.keys(enumAttributes).map((key) => [key, 1]));
    candidates.push({ seq: seq++, proposal, evidence: evidence({ description: 1, ...enumConfidence }, warnings), ...(via !== undefined ? { viaHint: via } : {}), aliasProposals: [] });
  }

  return { candidates, skipped };
}
