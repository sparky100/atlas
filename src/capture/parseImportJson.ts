/**
 * Reads a capture run's JSON input into `{ systems, relationships, changes }`,
 * where `systems`/`relationships` are arrays of plain objects keyed by the
 * identical snake_case column names a Systems/Relationships spreadsheet
 * sheet uses (`IMPORT_COLUMNS`/`RELATIONSHIP_IMPORT_COLUMNS`) —
 * `validateImportRow`/`validateImportRelationshipRow` take a
 * `Record<string, unknown>` keyed by column name regardless of whether it
 * came from a spreadsheet cell or a JSON value, so this module runs every
 * entry through the *exact same* validators a spreadsheet row does, never a
 * second copy of the business rules. `changes` (`importChangeRow.ts`) has no
 * spreadsheet equivalent — see that module's own doc comment for why. Value
 * streams are deliberately not a section here: ADR-023 forbids capture from
 * proposing a value stream or stage at all (Sprint F2b).
 *
 * `parseImportJsonText` (SPEC-capture.md §5.6) is the pure half of this
 * module, taking already-read text rather than a browser `File` —
 * `runCapture.ts` calls it directly (it also runs in a Deno edge function,
 * where `File`/`file.text()` don't exist); `parseImportJson` below is a thin
 * wrapper for a browser caller with an actual `File` in hand.
 */
import { validateImportChangeRow, type ImportChangeRowResult } from './importChangeRow';
import { validateImportRelationshipRow, type ImportRelationshipRowResult } from './importRelationshipRow';
import { validateImportRow, type ImportRowResult } from './importRowSchema';
import { ImportFileParseError, PREVIEW_ROW_COUNT, type ParsedImportFile } from './parseImportFile';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseImportJsonText(text: string, fileName: string): ParsedImportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ImportFileParseError(`Could not read "${fileName}" as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isPlainObject(parsed)) {
    throw new ImportFileParseError(`"${fileName}" must be a JSON object with a "systems" array.`);
  }

  const rawSystems = parsed.systems;
  if (!Array.isArray(rawSystems) || rawSystems.length === 0) {
    throw new ImportFileParseError(`"${fileName}" must have a non-empty "systems" array.`);
  }

  const rows: ParsedImportFile['rows'] = [];
  const errors: ParsedImportFile['errors'] = [];
  rawSystems.forEach((raw: unknown, index) => {
    if (!isPlainObject(raw)) {
      errors.push({ rowNumber: index + 1, error: 'each "systems" entry must be an object' });
      return;
    }
    const result: ImportRowResult = validateImportRow(raw, index + 1);
    if (result.ok) rows.push(result.row);
    else errors.push({ rowNumber: result.rowNumber, error: result.error });
  });

  const rawRelationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];
  const relationshipRows: ParsedImportFile['relationshipRows'] = [];
  const relationshipErrors: ParsedImportFile['relationshipErrors'] = [];
  rawRelationships.forEach((raw: unknown, index) => {
    if (!isPlainObject(raw)) {
      relationshipErrors.push({ rowNumber: index + 1, error: 'each "relationships" entry must be an object' });
      return;
    }
    const result: ImportRelationshipRowResult = validateImportRelationshipRow(raw, index + 1);
    if (result.ok) relationshipRows.push(result.row);
    else relationshipErrors.push({ rowNumber: result.rowNumber, error: result.error });
  });

  const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];
  const changeRows: ParsedImportFile['changeRows'] = [];
  const changeErrors: ParsedImportFile['changeErrors'] = [];
  rawChanges.forEach((raw: unknown, index) => {
    if (!isPlainObject(raw)) {
      changeErrors.push({ rowNumber: index + 1, error: 'each "changes" entry must be an object' });
      return;
    }
    const result: ImportChangeRowResult = validateImportChangeRow(raw, index + 1);
    if (result.ok) changeRows.push(result.row);
    else changeErrors.push({ rowNumber: result.rowNumber, error: result.error });
  });

  const detectedColumns = Object.keys(parsed).filter((key) => key === 'systems' || key === 'relationships' || key === 'changes');
  return { fileName, detectedColumns, previewRows: rawSystems.slice(0, PREVIEW_ROW_COUNT) as Record<string, unknown>[], rows, errors, relationshipRows, relationshipErrors, changeRows, changeErrors };
}

export async function parseImportJson(file: File): Promise<ParsedImportFile> {
  const text = await file.text();
  return parseImportJsonText(text, file.name);
}
