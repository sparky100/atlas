/**
 * F2 (full K1), SPEC-capture.md §5.4: value normalisation for cell/passage
 * text — enum fuzzy-matching, date parsing, booleans, and the name-suffix
 * alias rule. Pure; each parser returns `null` when the raw text parses to
 * nothing usable (the attribute is then omitted entirely — rule 5's "never
 * guess" spirit — never defaulted to a made-up value).
 */
import type { Disposition, HostingModel, LifecycleStatus } from '../contracts/delta';

export interface EnumParseResult<T extends string> {
  value: T;
  /** `true` when the match came from the fuzzy synonym table, not an exact value — callers apply `PARSE_FACTORS.ENUM_FUZZY` (confidence.ts) only in that case. */
  fuzzy: boolean;
}

function parseEnumFuzzy<T extends string>(raw: string, exactValues: readonly T[], synonyms: Readonly<Record<string, T>>): EnumParseResult<T> | null {
  const normalised = raw.trim().toLowerCase();
  const exact = exactValues.find((v) => v.toLowerCase() === normalised);
  if (exact) return { value: exact, fuzzy: false };
  const fuzzyHit = synonyms[normalised];
  if (fuzzyHit) return { value: fuzzyHit, fuzzy: true };
  return null;
}

const LIFECYCLE_VALUES: readonly LifecycleStatus[] = ['planned', 'active', 'retiring', 'retired'];

/** §5.4's own fuzzy table — every listed synonym, verbatim. */
const LIFECYCLE_SYNONYMS: Readonly<Record<string, LifecycleStatus>> = {
  live: 'active',
  'in service': 'active',
  production: 'active',
  operational: 'active',
  current: 'active',
  pipeline: 'planned',
  planned: 'planned',
  proposed: 'planned',
  'in procurement': 'planned',
  future: 'planned',
  sunset: 'retiring',
  decommissioning: 'retiring',
  'end of life': 'retiring',
  'being replaced': 'retiring',
  legacy: 'retiring',
  decommissioned: 'retired',
  retired: 'retired',
  closed: 'retired',
  'switched off': 'retired',
  gone: 'retired',
};

export function parseLifecycle(raw: string): EnumParseResult<LifecycleStatus> | null {
  return parseEnumFuzzy(raw, LIFECYCLE_VALUES, LIFECYCLE_SYNONYMS);
}

const HOSTING_MODEL_VALUES: readonly HostingModel[] = ['on_premises', 'private_cloud', 'public_cloud', 'saas', 'hybrid'];

/**
 * §5.4 says only "parseEnumFuzzy(raw, HOSTING_MODEL_VALUES) — same ENUM_FUZZY
 * shape as lifecycleStatus" with no synonym table of its own. This table is
 * a disclosed, conservative fill of that gap: common real-register phrasing
 * for each of the five closed values, nothing invented beyond direct
 * synonyms (no attempt to guess "cloud" alone between private/public —
 * that stays unparsed, `ENUM_UNPARSED`, rather than a coin flip).
 */
const HOSTING_MODEL_SYNONYMS: Readonly<Record<string, HostingModel>> = {
  'on-prem': 'on_premises',
  'on prem': 'on_premises',
  onprem: 'on_premises',
  'on-premise': 'on_premises',
  'on premise': 'on_premises',
  'in-house': 'on_premises',
  'private cloud': 'private_cloud',
  'public cloud': 'public_cloud',
  'software as a service': 'saas',
  hybrid: 'hybrid',
  mixed: 'hybrid',
};

export function parseHostingModel(raw: string): EnumParseResult<HostingModel> | null {
  return parseEnumFuzzy(raw, HOSTING_MODEL_VALUES, HOSTING_MODEL_SYNONYMS);
}

const DISPOSITION_VALUES: readonly Disposition[] = ['tolerate', 'invest', 'migrate', 'eliminate'];

/**
 * F11: TIME disposition. A conservative synonym table: TIME's own one-letter
 * codes, and direct register wording for each value only. Ambiguous words
 * ("modernise", "review", "rationalise") stay unparsed — `ENUM_UNPARSED`,
 * never a guess.
 */
const DISPOSITION_SYNONYMS: Readonly<Record<string, Disposition>> = {
  t: 'tolerate',
  retain: 'tolerate',
  keep: 'tolerate',
  maintain: 'tolerate',
  i: 'invest',
  grow: 'invest',
  enhance: 'invest',
  m: 'migrate',
  replace: 'migrate',
  replatform: 'migrate',
  e: 'eliminate',
  retire: 'eliminate',
  decommission: 'eliminate',
  sunset: 'eliminate',
};

export function parseDisposition(raw: string): EnumParseResult<Disposition> | null {
  return parseEnumFuzzy(raw, DISPOSITION_VALUES, DISPOSITION_SYNONYMS);
}

export interface DateParseResult {
  /** ISO `yyyy-mm-dd`. */
  value: string;
  /** `true` for a month/quarter/bare-year approximation (`AMBIGUOUS_DATE`) — never for the ordinary dd/mm-vs-mm/dd numeric swap, which §5.4 resolves deterministically with no warning. */
  ambiguous: boolean;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** §5.4: ISO, then `dd/mm/yyyy` (UK default; swaps to `mm/dd/yyyy` only when the second number can't be a month), then `Mon yyyy`/`yyyy-Qn` (first of month/quarter, `ambiguous`), then a bare year (`yyyy-01-01`, `ambiguous`). */
export function parseDate(raw: string): DateParseResult | null {
  const trimmed = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return { value: trimmed, ambiguous: false };

  const quarter = /^(\d{4})-Q([1-4])$/i.exec(trimmed);
  if (quarter?.[1] !== undefined && quarter[2] !== undefined) {
    const month = (Number(quarter[2]) - 1) * 3 + 1;
    return { value: `${quarter[1]}-${pad2(month)}-01`, ambiguous: true };
  }

  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (monthYear?.[1] !== undefined && monthYear[2] !== undefined) {
    const month = MONTH_NAMES[monthYear[1].toLowerCase()];
    if (month !== undefined) return { value: `${monthYear[2]}-${pad2(month)}-01`, ambiguous: true };
  }

  const bareYear = /^(\d{4})$/.exec(trimmed);
  if (bareYear) return { value: `${trimmed}-01-01`, ambiguous: true };

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (slash?.[1] !== undefined && slash[2] !== undefined && slash[3] !== undefined) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = slash[3];
    let day: number;
    let month: number;
    if (second <= 12) {
      day = first;
      month = second;
    } else if (first <= 12) {
      day = second;
      month = first;
    } else {
      return null;
    }
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return { value: `${year}-${pad2(month)}-${pad2(day)}`, ambiguous: false };
  }

  return null;
}

const TRUE_VALUES = new Set(['yes', 'true', 'external', 'saas', 'hosted']);
const FALSE_VALUES = new Set(['no', 'false', 'internal', 'on-prem', 'on prem']);

/** §5.2/§5.4: `yes/true/external/saas/hosted` → `true`; `no/false/internal/on-prem` → `false`; anything else is omitted (`null`), never guessed. */
export function parseBool(raw: string): boolean | null {
  const normalised = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  return null;
}

const PERMISSIVE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** §5.4: "must match a permissive email regex, else omitted." */
export function parseEmail(raw: string): string | null {
  const trimmed = raw.trim();
  return PERMISSIVE_EMAIL.test(trimmed) ? trimmed : null;
}

export interface NameParseResult {
  /** Trimmed, internal whitespace collapsed — the suffix (if any) is kept, never stripped from the stored name. */
  name: string;
  /** The bare stem, proposed as an extra `name`-type alias, when the name carries a trailing "(legacy)"/"- old"/"v2"-style suffix. */
  stemAlias?: string;
}

const TRAILING_SUFFIX = /\s+(\(legacy\)|-\s*old|v\d+)$/i;

/** §5.4: trims and collapses whitespace; a trailing "(legacy)"/"- old"/"v2"-style suffix is kept on the name itself (it may be the real name) but the bare stem is proposed as an extra alias. */
export function parseName(raw: string): NameParseResult {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  const match = TRAILING_SUFFIX.exec(collapsed);
  if (!match) return { name: collapsed };
  const stem = collapsed.slice(0, match.index).trim();
  return stem.length > 0 ? { name: collapsed, stemAlias: stem } : { name: collapsed };
}

/** §5.4's second default's own heuristic: "unless the value contains an email or looks like Firstname Surname" — two capitalised words, no other punctuation. Row/column-presence decisions about *when* to apply either default belong to `rowsToCandidates.ts` (PR5), not here — this is only the text-shape heuristic that default's own carve-out needs. */
export function looksLikePersonName(raw: string): boolean {
  const trimmed = raw.trim();
  if (PERMISSIVE_EMAIL.test(trimmed)) return true;
  return /^[A-Z][a-zA-Z'-]*\s+[A-Z][a-zA-Z'-]*$/.test(trimmed);
}

export interface OwnerCellParseResult {
  name: string;
  /** `null` for a plain name; the parenthetical's own text for an owner marked external. */
  externalOrganisation: string | null;
}

const EXTERNAL_OWNER = /^(.*?)\s*\(\s*external\s*:\s*(.+?)\s*\)\s*$/i;

/** Sprint F2b (SPEC-capture.md §5.2), folded in from F2-lite's own `importRowSchema.ts` `parseOwnerCell`: an `owner`/`technicalOwner` cell of the form `"Name (External: Org)"` (case-insensitive on the literal word "External") marks the owner as a third-party organisation rather than an internal team/person. A plain name with no parenthetical returns `externalOrganisation: null` unchanged. */
export function parseOwnerCell(raw: string): OwnerCellParseResult {
  const trimmed = raw.trim();
  const match = EXTERNAL_OWNER.exec(trimmed);
  if (!match) return { name: trimmed, externalOrganisation: null };
  const [, name, org] = match;
  return { name: name && name.length > 0 ? name : trimmed, externalOrganisation: org ?? null };
}
