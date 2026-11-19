/**
 * The `systems` section of a capture run's JSON input (`parseImportJson.ts`,
 * SPEC-capture.md §5.6) — one JSON object per top-level system or module,
 * keyed by the same snake_case column names this format has always used.
 *
 * One entry is either a top-level system (`platform` unset) or a module —
 * a container parented to a named platform (`platform` set): "platform
 * field alone decides structure" — `kind` is a plain system attribute,
 * never a structural discriminator, and a module's `parentId` is resolved
 * later, once the model's own systems are loaded (`runCapture.ts`), not
 * here.
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
 * for the export side. `parseImportJson.ts` is the one caller that reads a
 * real file and hands each raw entry here.
 */
import { validateAttributeValue } from '../contracts/attributeSchema';
import { normalizeName } from '../engine/merge';
import { FIT_FOR_PURPOSE_ORDER } from '../engine/elementRead/fitForPurpose';
import type { FitForPurpose } from '../contracts/delta';

/** The exact header names a row must use — order doesn't matter, extra columns are ignored, case-sensitive (matching every other attribute key in this product). Snake_case, this session's own plan's spelling — distinct from the camelCase attribute keys they map onto below. */
export const IMPORT_COLUMNS = ['name', 'description', 'kind', 'lifecycle', 'criticality', 'annual_run_cost', 'disposition', 'domain', 'hosting_model', 'vendor', 'is_external', 'external_organisation', 'platform', 'capability', 'fit', 'business_owner', 'technical_owner', 'interface_type', 'transformation', 'introduced', 'planned_end', 'support_ends_at', 'ai_autonomy', 'ai_use'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export type ImportRowElementType = 'system' | 'container';

export type ImportRowAttributeKey = 'description' | 'kind' | 'lifecycleStatus' | 'criticality' | 'annualRunCost' | 'disposition' | 'domain' | 'hostingModel' | 'vendor' | 'externalOrganisation' | 'interfaceType' | 'transformation' | 'introduced' | 'plannedEnd' | 'supportEndsAt' | 'aiAutonomy' | 'aiUse';

/** An owner column's own cell — either a plain name, or "Name (External: Org)" (import close-out), which creates the owner as an external organisation actor (`subtype: 'organisation'`, `isExternal: true`, `externalOrganisation: Org`) if no existing actor named `name` already resolves it. */
export interface OwnerReference {
  name: string;
  externalOrganisation: string | null;
}

/** One validated row, ready for matching (`runCapture.ts`) — `attributes`/`isExternal` only carry keys the row actually set (an omitted/blank optional column means "don't touch this attribute" for a matched row, and "use the schema default" for a new one, same as every other create/edit path in this app). `platformName`/`capabilityNames`/`businessOwner`/`technicalOwner` are raw row text, not resolved here — resolving a name against the model's own elements needs the model's own current head, which this pure module has no access to. */
export interface ImportRow {
  /** 1-based row number in the source file, for error messages and per-delta `sourceRef` — never used as an id. */
  rowNumber: number;
  name: string;
  /** `'container'` (a module) iff `platform` was set — "platform column alone decides structure". */
  elementType: ImportRowElementType;
  attributes: Partial<Record<ImportRowAttributeKey, string>>;
  /** `isExternal` is the one boolean-kind column (`is_external`) — kept outside `attributes` (a string-only bag) rather than widening that type for one field. `undefined` means the column was blank (don't touch this fact); `true`/`false` is always a deliberate value from the file. */
  isExternal: boolean | undefined;
  /** The platform this row's module belongs to, by name — `null` means this row is a top-level system. Resolved (matched, never created) at match time. */
  platformName: string | null;
  /** Import close-out: the `capability` column accepts a `|`-delimited list — the first name is the primary `supports` link, the rest secondary. Empty array means the column was blank. */
  capabilityNames: string[];
  /** Owner-approved importer exception (Simon, 2026-11-16): the fit-for-purpose rating of this system's capability link(s), JSON format only. It is a `supports` link attribute, not a system attribute, so it lives outside `attributes`; `undefined` means the field was absent. Applied to every capability link this row creates; ignored when the row names no capability. */
  fit?: FitForPurpose | undefined;
  businessOwner: OwnerReference | null;
  technicalOwner: OwnerReference | null;
  /** JSON import follow-up: a supporting quote from whatever the file's author is working from — free text, never validated beyond non-blank. Carried onto every delta this row produces, appended to `sourceRef`. */
  quote?: string | undefined;
  /** JSON import follow-up: a confidence in [0,1] for this row as a whole — overrides the otherwise-hardcoded `1` on every delta this row produces. */
  confidence?: number | undefined;
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

/** Column header → the attribute key it sets, and nothing else — `platform`/`capability`/`business_owner`/`technical_owner` are resolved as references, not plain attributes, and `is_external` is its own boolean-kind column (below), so none of those five are in this list. */
const ATTRIBUTE_COLUMNS: readonly (readonly [ImportColumn, ImportRowAttributeKey])[] = [
  ['description', 'description'],
  ['kind', 'kind'],
  ['lifecycle', 'lifecycleStatus'],
  ['criticality', 'criticality'],
  ['annual_run_cost', 'annualRunCost'],
  ['disposition', 'disposition'],
  ['domain', 'domain'],
  ['hosting_model', 'hostingModel'],
  ['vendor', 'vendor'],
  ['external_organisation', 'externalOrganisation'],
  // ADR-026: an interface on an integration platform — container-only, so a system row setting either fails validation.
  ['interface_type', 'interfaceType'],
  ['transformation', 'transformation'],
  // Roadmap dates (ISO YYYY-MM-DD). `support_ends_at` is system-only (vendor support end), so a module row setting it fails validation.
  ['introduced', 'introduced'],
  ['planned_end', 'plannedEnd'],
  ['support_ends_at', 'supportEndsAt'],
  // Owner-approved importer exception (Simon, 2026-11-16, "Yes A"): the two AI fields, so a demo or JSON import can record them. Same enum check as every other column; system-only attributes, so a module row setting either fails validation.
  ['ai_autonomy', 'aiAutonomy'],
  ['ai_use', 'aiUse'],
];

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);

/** `is_external`'s own cell → a real boolean, or `undefined` for blank — `undefined` for anything else too (an unrecognised word), which `validateImportRow` below turns into a real error rather than silently treating a typo as "blank". */
function cellToBooleanWord(cell: string): boolean | undefined {
  const normalized = cell.toLowerCase();
  if (TRUE_WORDS.has(normalized)) return true;
  if (FALSE_WORDS.has(normalized)) return false;
  return undefined;
}

/** "Name (External: Org)" → `{name, externalOrganisation}`; a plain name has no parens and gets `externalOrganisation: null`. Case-insensitive on the literal word "External"; the org text itself is kept verbatim. */
function parseOwnerCell(cell: string): OwnerReference {
  const match = /^(.*?)\s*\(\s*external\s*:\s*(.+?)\s*\)\s*$/i.exec(cell);
  if (!match) return { name: cell, externalOrganisation: null };
  const [, name, org] = match;
  return { name: name && name.length > 0 ? name : cell, externalOrganisation: org ?? null };
}

/** The `capability` column's own `|`-delimited list — trimmed, blanks between pipes dropped, first survivor is the primary. Also deduplicated (case-insensitive) — a repeated name in the same cell (a copy-paste typo, most often) would otherwise become two `supports` creates for the same (system, capability) pair in one commit, which V6 (SPEC §5.2, src/engine/deltas.ts's own `relationship.create` check) now rejects outright rather than letting it reach `relationships_head` as a duplicate. */
function parseCapabilityList(cell: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of cell.split('|')) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** `confidence`'s own cell → a number in [0,1], or `undefined` for a genuinely blank cell — anything else (out of range, unparseable) is a real validation error, never a silently-treated-as-blank typo (`cellToBooleanWord`'s own stance above). Duplicated verbatim in `importRelationshipRow.ts`/`importChangeRow.ts` — this module's own small-private-helper convention (`cellToString` is already tripled the same way), not a shared util. */
function parseConfidence(raw: unknown): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: undefined };
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(num) || num < 0 || num > 1) return { ok: false, error: 'must be a number between 0 and 1' };
  return { ok: true, value: num };
}

/**
 * A module row's own `name` occasionally arrives pre-qualified as
 * "Platform · Module" — the exact compound form this format uses to
 * *reference* a module from `relationships`/`changes` entries, echoed back
 * into the row's own `name` field by mistake (an AI-authored import is
 * especially prone to this: it's the same convention it was shown for
 * referencing a module, just misapplied to naming one). Left alone, this
 * both fails to match the real, bare-named existing module (creating an
 * ugly duplicate) and breaks every relationship/change entry that
 * references this same file's own new module by its bare name.
 * Stripped once, here, only when the prefix's own platform half matches this
 * row's own `platform` field exactly — never a module name that genuinely
 * contains "·" for an unrelated reason.
 */
function stripRedundantPlatformPrefix(name: string, platformName: string | null): string {
  if (platformName === null) return name;
  const compound = name.split('·').map((s) => s.trim());
  if (compound.length !== 2 || !compound[0] || !compound[1]) return name;
  return normalizeName(compound[0]) === normalizeName(platformName) ? compound[1] : name;
}

/** Validates one raw row object (as `XLSX.utils.sheet_to_json` produces, keyed by header name) against the F2-lite format. Reuses `validateAttributeValue` for every core attribute rather than re-implementing the enum/text checks this product already has one place for. */
export function validateImportRow(raw: Record<string, unknown>, rowNumber: number): ImportRowResult {
  const rawName = cellToString(raw.name);
  if (rawName === undefined) {
    return { ok: false, rowNumber, error: '"name" is required' };
  }

  const platformName = cellToString(raw.platform) ?? null;
  const elementType: ImportRowElementType = platformName === null ? 'system' : 'container';
  const name = stripRedundantPlatformPrefix(rawName, platformName);

  const attributes: ImportRow['attributes'] = {};
  for (const [column, key] of ATTRIBUTE_COLUMNS) {
    const cell = cellToString(raw[column]);
    if (cell === undefined) continue;
    // Modules now carry their own support end in the model, but the importer is unchanged until Simon approves importing it (2026-11-19): a module row still fails here.
    if (elementType === 'container' && key === 'supportEndsAt') return { ok: false, rowNumber, error: `"${column}": \`container\` has no "supportEndsAt" attribute` };
    const result = validateAttributeValue(elementType, key, cell);
    if (!result.ok) return { ok: false, rowNumber, error: `"${column}": ${result.error}` };
    // `validateAttributeValue` normalises to `Json`, which for every one of
    // these nine keys is always a plain string when the input wasn't
    // empty (text/enum kinds only, per the column list above) — safe to
    // narrow back for `ImportRow`'s own string-only attributes shape.
    if (typeof result.value === 'string') attributes[key] = result.value;
  }

  const isExternalCell = cellToString(raw.is_external);
  let isExternal: boolean | undefined;
  if (isExternalCell !== undefined) {
    isExternal = cellToBooleanWord(isExternalCell);
    if (isExternal === undefined) return { ok: false, rowNumber, error: `"is_external" must be true/false (or yes/no), got "${isExternalCell}"` };
    const result = validateAttributeValue(elementType, 'isExternal', isExternal);
    if (!result.ok) return { ok: false, rowNumber, error: `"is_external": ${result.error}` };
  }

  const fitCell = cellToString(raw.fit);
  let fit: FitForPurpose | undefined;
  if (fitCell !== undefined) {
    const normalised = fitCell.toLowerCase();
    if (!(normalised in FIT_FOR_PURPOSE_ORDER)) return { ok: false, rowNumber, error: `"fit" must be one of: ${Object.keys(FIT_FOR_PURPOSE_ORDER).join(', ')}, got "${fitCell}"` };
    fit = normalised as FitForPurpose;
  }

  const businessOwnerCell = cellToString(raw.business_owner);
  const technicalOwnerCell = cellToString(raw.technical_owner);

  const confidenceResult = parseConfidence(raw.confidence);
  if (!confidenceResult.ok) return { ok: false, rowNumber, error: `"confidence": ${confidenceResult.error}` };

  return {
    ok: true,
    row: {
      rowNumber,
      name,
      elementType,
      attributes,
      isExternal,
      platformName,
      capabilityNames: parseCapabilityList(cellToString(raw.capability) ?? ''),
      fit,
      businessOwner: businessOwnerCell !== undefined ? parseOwnerCell(businessOwnerCell) : null,
      technicalOwner: technicalOwnerCell !== undefined ? parseOwnerCell(technicalOwnerCell) : null,
      quote: cellToString(raw.quote),
      confidence: confidenceResult.value,
    },
  };
}
