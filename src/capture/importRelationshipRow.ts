/**
 * F2-lite import close-out — the optional "Relationships" sheet (XLSX only;
 * a plain CSV has no second sheet to carry one, so a CSV import simply
 * never has relationship rows). One row per `uses`/`flows_to` edge, in the
 * same change as the main sheet's element rows.
 *
 * Pure — endpoints (`from`/`to`/`via`) are captured as raw text here, not
 * resolved: resolving a name (or a "Platform · Module" compound reference)
 * against the model's own elements, or this same file's own newly-created
 * rows, needs data this module has no access to (`buildImportCommit.ts`
 * does the resolving, alongside building every delta).
 */
import { validateRelationshipAttributeValue } from '../contracts/relationshipAttributeSchema';

export const RELATIONSHIP_IMPORT_COLUMNS = ['from', 'type', 'to', 'description', 'via', 'data_classification'] as const;
export type RelationshipImportColumn = (typeof RELATIONSHIP_IMPORT_COLUMNS)[number];

export type ImportRelationshipType = 'uses' | 'flows_to';

export interface ImportRelationshipRow {
  rowNumber: number;
  from: string;
  type: ImportRelationshipType;
  to: string;
  /** The verb phrase — required for both types (`relationshipAttributeSchema.ts`'s own `USES_META`/`FLOWS_TO_META.description`). */
  description: string;
  /** An integration platform this flow actually goes via — resolved (and kind-checked) later; `null` means direct. */
  via: string | null;
  /** `flows_to` only — `uses` has no such attribute (`UsesAttributes`), so a `uses` row setting this fails validation the same way a module row setting `vendor` does. */
  dataClassification: string | null;
}

export type ImportRelationshipRowResult = { ok: true; row: ImportRelationshipRow } | { ok: false; rowNumber: number; error: string };

function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

export function validateImportRelationshipRow(raw: Record<string, unknown>, rowNumber: number): ImportRelationshipRowResult {
  const from = cellToString(raw.from);
  if (from === undefined) return { ok: false, rowNumber, error: '"from" is required' };
  const to = cellToString(raw.to);
  if (to === undefined) return { ok: false, rowNumber, error: '"to" is required' };

  const typeCell = cellToString(raw.type);
  if (typeCell !== 'uses' && typeCell !== 'flows_to') return { ok: false, rowNumber, error: '"type" must be "uses" or "flows_to"' };
  const type: ImportRelationshipType = typeCell;

  const descriptionResult = validateRelationshipAttributeValue(type, 'description', cellToString(raw.description) ?? null);
  if (!descriptionResult.ok) return { ok: false, rowNumber, error: `"description": ${descriptionResult.error}` };
  if (typeof descriptionResult.value !== 'string') return { ok: false, rowNumber, error: '"description" is required' };

  let dataClassification: string | null = null;
  const dataClassificationCell = cellToString(raw.data_classification);
  if (dataClassificationCell !== undefined) {
    const result = validateRelationshipAttributeValue(type, 'dataClassification', dataClassificationCell);
    if (!result.ok) return { ok: false, rowNumber, error: `"data_classification": ${result.error}` };
    if (typeof result.value === 'string') dataClassification = result.value;
  }

  return { ok: true, row: { rowNumber, from, type, to, description: descriptionResult.value, via: cellToString(raw.via) ?? null, dataClassification } };
}
