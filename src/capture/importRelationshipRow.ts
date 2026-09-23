/**
 * A relationship row from a capture run's "Relationships" spreadsheet sheet
 * or a JSON file's `relationships` array — one row per `uses`/`flows_to`
 * edge, alongside the same run's element rows.
 *
 * Pure — endpoints (`from`/`to`/`via`) are captured as raw text here, not
 * resolved: resolving a name (or a "Platform · Module" compound reference)
 * against the model's own elements, or this same run's own newly-created
 * rows, needs data this module has no access to (`runCapture.ts`'s own
 * matching does the resolving, `buildPromotionEnvelope.ts` builds every
 * delta).
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
  /** JSON import follow-up: a supporting quote from whatever the file's author is working from — free text, never validated beyond non-blank. Carried onto every delta this row produces, appended to `sourceRef`. */
  quote?: string | undefined;
  /** JSON import follow-up: a confidence in [0,1] for this row as a whole — overrides the otherwise-hardcoded `1` on every delta this row produces. */
  confidence?: number | undefined;
}

export type ImportRelationshipRowResult = { ok: true; row: ImportRelationshipRow } | { ok: false; rowNumber: number; error: string };

function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

/** `confidence`'s own cell → a number in [0,1], or `undefined` for blank — see `importRowSchema.ts`'s identical helper for the full doc comment; duplicated per this module's own small-private-helper convention. */
function parseConfidence(raw: unknown): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: undefined };
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(num) || num < 0 || num > 1) return { ok: false, error: 'must be a number between 0 and 1' };
  return { ok: true, value: num };
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

  const confidenceResult = parseConfidence(raw.confidence);
  if (!confidenceResult.ok) return { ok: false, rowNumber, error: `"confidence": ${confidenceResult.error}` };

  return { ok: true, row: { rowNumber, from, type, to, description: descriptionResult.value, via: cellToString(raw.via) ?? null, dataClassification, quote: cellToString(raw.quote), confidence: confidenceResult.value } };
}
