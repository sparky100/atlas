/**
 * F2 (narrowed capture pipeline), Phase 1 — the fixed CSV/XLSX column
 * format a spreadsheet import must take (this session's plan, "The CSV
 * format (v1, Phases 1-2)"): one row per **system**. Deliberately not the
 * full `docs/SPEC-capture.md` design (no LLM column-synonym inference, no
 * PDF/pasted text, no other element types yet) — see that plan for what's
 * explicitly deferred and why.
 *
 * Pure — no `xlsx` import here, so this stays unit-testable without it,
 * same split `elementExport.ts`/`elementExportXlsx.ts` already established
 * for the export side (that file's own comment: "the only place SheetJS is
 * imported, so the pure sheet-building stays testable without it").
 * `parseImportFile.ts` is the one caller that reads a real file and hands
 * each raw row here.
 */
import { validateAttributeValue } from '../contracts/attributeSchema';
import type { UUID } from '../contracts/delta';

/** The exact header names a row must use — order doesn't matter, extra columns are ignored, case-sensitive (matching every other attribute key in this product). */
export const IMPORT_COLUMNS = ['id', 'name', 'description', 'lifecycleStatus', 'criticality', 'vendor', 'hostingModel', 'supports'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** One validated row, ready for matching (`matchImportRows.ts`) — `attributes` only carries keys the row actually set (an omitted/blank optional column means "don't touch this attribute" for a matched row, and "use the schema default" for a new one, same as every other create/edit path in this app). */
export interface ImportRow {
  /** 1-based row number in the source file, for error messages — never used as an id. */
  rowNumber: number;
  id: UUID | null;
  name: string;
  attributes: Partial<Record<'description' | 'lifecycleStatus' | 'criticality' | 'vendor' | 'hostingModel', string>>;
  /** A capability's own name, to resolve into a `supports` relationship at match time — not resolved here, since that needs the current model's own capability list, which this pure module has no access to. */
  supportsCapabilityName: string | null;
}

export type ImportRowResult = { ok: true; row: ImportRow } | { ok: false; rowNumber: number; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One raw parsed cell → its string form, or `undefined` for a genuinely
 * blank cell — `sheet_to_json`'s own `defval: null` convention plus XLSX
 * sometimes handing back a number/boolean for a cell that looks like one
 * (a `lifecycleStatus` of `active` never does, but a stray numeric-looking
 * name shouldn't silently become a JS number). A spreadsheet cell is
 * never an object (SheetJS's own cell types are string/number/boolean/
 * date/null) — the explicit `typeof` narrowing below is what lets
 * `String(raw)` past the type checker's "never `String()` an arbitrary
 * `unknown`, it might be an object with no real `toString`" rule, rather
 * than a blanket suppression.
 */
function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

/** Validates one raw row object (as `XLSX.utils.sheet_to_json` produces, keyed by header name) against the v1 format. Reuses `validateAttributeValue` for every core `system` attribute rather than re-implementing the enum/text checks this product already has one place for. */
export function validateImportRow(raw: Record<string, unknown>, rowNumber: number): ImportRowResult {
  const rawId = cellToString(raw.id);
  if (rawId !== undefined && !UUID_PATTERN.test(rawId)) {
    return { ok: false, rowNumber, error: `"id" must be a valid element id (uuid) or left blank, got "${rawId}"` };
  }

  const name = cellToString(raw.name);
  if (name === undefined) {
    return { ok: false, rowNumber, error: '"name" is required' };
  }

  const attributes: ImportRow['attributes'] = {};
  for (const key of ['description', 'lifecycleStatus', 'criticality', 'vendor', 'hostingModel'] as const) {
    const cell = cellToString(raw[key]);
    if (cell === undefined) continue;
    const result = validateAttributeValue('system', key, cell);
    if (!result.ok) return { ok: false, rowNumber, error: result.error };
    // `validateAttributeValue` normalises to `Json`, which for every one of
    // these five keys is always a plain string when the input wasn't
    // empty (text/enum kinds only, per the column list above) — safe to
    // narrow back for `ImportRow`'s own string-only attributes shape.
    if (typeof result.value === 'string') attributes[key] = result.value;
  }

  const supportsCapabilityName = cellToString(raw.supports) ?? null;

  return { ok: true, row: { rowNumber, id: rawId ?? null, name, attributes, supportsCapabilityName } };
}
