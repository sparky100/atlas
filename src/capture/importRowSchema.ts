/**
 * F2-lite ("spreadsheet import as reconciliation") — supersedes F2 Phase
 * 1/2's narrower "one row = one system, `id` always wins" format. The fixed
 * CSV/XLSX column format a spreadsheet import must take. Still deliberately
 * not the full `docs/SPEC-capture.md` design (no LLM column-synonym
 * inference, no PDF/pasted text, no `capture_jobs`/re-import row-key
 * tracking) — see that plan for what's explicitly deferred and why.
 *
 * One row is either a top-level system (`platform` blank) or a module —
 * a container parented to a named platform (`platform` set): "platform
 * column alone decides structure" (this session's own design call) — `kind`
 * is a plain system attribute, never a structural discriminator, and a
 * module's `parentId` is resolved later, once the model's own systems are
 * loaded (`matchImportRows.ts`), not here.
 *
 * Reusing `validateAttributeValue(elementType, key, ...)` for every column
 * (rather than hand-rolling a system/container split) gets a column's
 * inapplicability to the wrong row shape for free: `kind`/`vendor` are
 * system-only attributes (`ContainerAttributes` has neither — a module has
 * no "kind" of its own, and never overrides its platform's vendor, the same
 * as `ContainerAttributes`'s own module-override doc comment already
 * excludes `vendor` from the set a module *can* override) — a module row
 * setting either produces this function's ordinary "`container` has no
 * attribute…" error, not a silently dropped value.
 *
 * Pure — no `xlsx` import here, so this stays unit-testable without it,
 * same split `elementExport.ts`/`elementExportXlsx.ts` already established
 * for the export side. `parseImportFile.ts` is the one caller that reads a
 * real file and hands each raw row here.
 */
import { validateAttributeValue } from '../contracts/attributeSchema';

/** The exact header names a row must use — order doesn't matter, extra columns are ignored, case-sensitive (matching every other attribute key in this product). Snake_case, this session's own plan's spelling — distinct from the camelCase attribute keys they map onto below. */
export const IMPORT_COLUMNS = ['name', 'description', 'kind', 'lifecycle', 'criticality', 'domain', 'hosting_model', 'vendor', 'platform', 'capability', 'business_owner', 'technical_owner'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export type ImportRowElementType = 'system' | 'container';

export type ImportRowAttributeKey = 'description' | 'kind' | 'lifecycleStatus' | 'criticality' | 'domain' | 'hostingModel' | 'vendor';

/** One validated row, ready for matching (`matchImportRows.ts`) — `attributes` only carries keys the row actually set (an omitted/blank optional column means "don't touch this attribute" for a matched row, and "use the schema default" for a new one, same as every other create/edit path in this app). `platformName`/`capabilityName`/`businessOwnerName`/`technicalOwnerName` are raw row text, not resolved here — resolving a name against the model's own elements needs the model's own current head, which this pure module has no access to. */
export interface ImportRow {
  /** 1-based row number in the source file, for error messages and per-delta `sourceRef` — never used as an id. */
  rowNumber: number;
  name: string;
  /** `'container'` (a module) iff `platform` was set — "platform column alone decides structure". */
  elementType: ImportRowElementType;
  attributes: Partial<Record<ImportRowAttributeKey, string>>;
  /** The platform this row's module belongs to, by name — `null` means this row is a top-level system. Resolved (matched, never created) at match time. */
  platformName: string | null;
  capabilityName: string | null;
  businessOwnerName: string | null;
  technicalOwnerName: string | null;
}

export type ImportRowResult = { ok: true; row: ImportRow } | { ok: false; rowNumber: number; error: string };

/**
 * One raw parsed cell → its string form, or `undefined` for a genuinely
 * blank cell — `sheet_to_json`'s own `defval: null` convention plus XLSX
 * sometimes handing back a number/boolean for a cell that looks like one. A
 * spreadsheet cell is never an object (SheetJS's own cell types are
 * string/number/boolean/date/null) — the explicit `typeof` narrowing below
 * is what lets `String(raw)` past the type checker's "never `String()` an
 * arbitrary `unknown`" rule, rather than a blanket suppression.
 */
function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

/** Column header → the attribute key it sets, and nothing else — `platform`/`capability`/`business_owner`/`technical_owner` are resolved as references, not plain attributes, so they're deliberately not in this list. Exported for `buildImportCommit.ts`'s own identical need (a changed/created attribute's own `sourceRef` names its column, not its attribute key) — one mapping, not two that could drift apart. */
export const ATTRIBUTE_COLUMNS: readonly (readonly [ImportColumn, ImportRowAttributeKey])[] = [
  ['description', 'description'],
  ['kind', 'kind'],
  ['lifecycle', 'lifecycleStatus'],
  ['criticality', 'criticality'],
  ['domain', 'domain'],
  ['hosting_model', 'hostingModel'],
  ['vendor', 'vendor'],
];

/** Validates one raw row object (as `XLSX.utils.sheet_to_json` produces, keyed by header name) against the F2-lite format. Reuses `validateAttributeValue` for every core attribute rather than re-implementing the enum/text checks this product already has one place for. */
export function validateImportRow(raw: Record<string, unknown>, rowNumber: number): ImportRowResult {
  const name = cellToString(raw.name);
  if (name === undefined) {
    return { ok: false, rowNumber, error: '"name" is required' };
  }

  const platformName = cellToString(raw.platform) ?? null;
  const elementType: ImportRowElementType = platformName === null ? 'system' : 'container';

  const attributes: ImportRow['attributes'] = {};
  for (const [column, key] of ATTRIBUTE_COLUMNS) {
    const cell = cellToString(raw[column]);
    if (cell === undefined) continue;
    const result = validateAttributeValue(elementType, key, cell);
    if (!result.ok) return { ok: false, rowNumber, error: `"${column}": ${result.error}` };
    // `validateAttributeValue` normalises to `Json`, which for every one of
    // these seven keys is always a plain string when the input wasn't
    // empty (text/enum kinds only, per the column list above) — safe to
    // narrow back for `ImportRow`'s own string-only attributes shape.
    if (typeof result.value === 'string') attributes[key] = result.value;
  }

  return {
    ok: true,
    row: {
      rowNumber,
      name,
      elementType,
      attributes,
      platformName,
      capabilityName: cellToString(raw.capability) ?? null,
      businessOwnerName: cellToString(raw.business_owner) ?? null,
      technicalOwnerName: cellToString(raw.technical_owner) ?? null,
    },
  };
}
