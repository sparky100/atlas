/**
 * `ParsedImportFile` — the shape a capture run's JSON input parses into
 * (`parseImportJson.ts`), reusing the row types and validators
 * (`importRowSchema.ts`/`importRelationshipRow.ts`/`importChangeRow.ts`)
 * that a spreadsheet capture row (`rowsToCandidates.ts`) resolves through
 * too, so a system/relationship/change proposal is validated the same way
 * regardless of which input format produced it.
 */
import type { ImportChangeRow } from './importChangeRow';
import type { ImportRelationshipRow } from './importRelationshipRow';
import type { ImportRow } from './importRowSchema';

export interface ParsedImportFile {
  fileName: string;
  /** Every column header the file's own header row actually has, in file order — the dialog's "detected columns" preview, before any per-row validation runs. For a JSON import (`parseImportJson.ts`), this is the top-level section names instead (`systems`, `relationships`, `changes`) — there being no header row to read. */
  detectedColumns: string[];
  /** The file's own first few raw rows (pre-validation, keyed by header) — the dialog's "first rows" preview. */
  previewRows: Record<string, unknown>[];
  /** Every row that validated. */
  rows: ImportRow[];
  /** Every row that didn't, in source order — a real error per row (`ImportRowResult`'s own `error`), never silently dropped. */
  errors: { rowNumber: number; error: string }[];
  /** Every row from the "relationships" section that validated. */
  relationshipRows: ImportRelationshipRow[];
  /** Every "relationships" entry that didn't validate — same "surfaced, never dropped" stance as `errors`. */
  relationshipErrors: { rowNumber: number; error: string }[];
  /** The "changes" section — retire/restore instructions against an existing element. */
  changeRows: ImportChangeRow[];
  /** Every "changes" entry that didn't validate. */
  changeErrors: { rowNumber: number; error: string }[];
}

/** How many of the file's own raw rows a preview would show, before any matching/classification runs. */
export const PREVIEW_ROW_COUNT = 5;

export class ImportFileParseError extends Error {}
