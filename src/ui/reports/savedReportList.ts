/**
 * Pure helpers for the saved-reports table on the Reports hub: plain-language
 * labels for a report's source and shape, and search + sort over the rows.
 * No I/O, nothing stored — a report's summary is derived from its spec.
 */
import type {
  ReportFilter,
  ReportSource,
  ReportSpec,
  ReportValue,
} from "../../contracts/reportSpec";
import { FINDING_FILTER_OPTIONS } from "../../db/elementBrowse";
import type { PortfolioSignalKey } from "../../engine/portfolio/portfolioSignals";
import { reportFieldLabel, reportValueLabel } from "./reportTable";
import type { SavedReportRow } from "../../db/types";

export type SavedReportSortKey = "updated" | "name";

const SOURCE_LABEL: Record<ReportSource, string> = {
  elements: "Elements",
  portfolio: "Portfolio",
  relationships: "Relationships",
  findings: "Findings",
};

export function sourceLabel(source: ReportSource): string {
  return SOURCE_LABEL[source];
}

/** A field key as words when it has no known label (a custom attribute's key): "supportEndsAt" and "support_ends_at" both read "support ends at". */
function fieldWords(field: string): string {
  const known = reportFieldLabel(field);
  const text = known !== field ? known : field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return text.toLowerCase();
}

function valueText(field: string, value: ReportValue): string {
  if (typeof value === 'number') return value.toLocaleString('en-GB');
  const text = reportValueLabel(field, value);
  // Mid-sentence: "Over £5m" reads "over £5m", but "SAP" stays "SAP".
  return /^[A-Z][a-z]/.test(text) ? lowerFirst(text) : text;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function plural(noun: string): string {
  if (noun.endsWith('s')) return noun;
  return /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
}

/** What each Portfolio signal means as a phrase that follows "systems". Exhaustive, so a new signal cannot reach a summary unlabelled. */
const SIGNAL_PHRASE: Record<PortfolioSignalKey, string> = {
  costly_poor_fit: 'that cost a lot and fit poorly',
  costly_low_criticality: 'that cost a lot but have low criticality',
  costly_exposed: 'that cost a lot and are exposed',
  costly_overlap: 'that cost a lot and overlap with other systems',
  cheap_poor_fit: 'that are cheap but fit poorly',
  invest_poor_fit: 'planned for investment that fit poorly',
  tolerate_costly_poor_fit: 'being tolerated even though they cost a lot and fit poorly',
  justified: 'whose cost is justified',
};

function signalPhrase(value: ReportValue | readonly ReportValue[]): string | null {
  if (typeof value !== 'string') return null;
  const key = value.replace(/\|/g, '') as PortfolioSignalKey;
  return key in SIGNAL_PHRASE ? SIGNAL_PHRASE[key] : null;
}

const SOURCE_NOUN: Record<ReportSource, string> = {
  elements: 'elements',
  portfolio: 'systems',
  relationships: 'relationships',
  findings: 'findings',
};

function listText(field: string, values: readonly ReportValue[]): string {
  const items = values.map((v) => valueText(field, v));
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1] ?? ''}`;
}

/** One condition as a clause that follows "where": "run cost is £1m–£5m", "planned action is Eliminate or Migrate". */
function whereClause(f: ReportFilter): string {
  const name = fieldWords(f.field);
  const value = f.value;
  const single = Array.isArray(value) ? '' : valueText(f.field, value as ReportValue);
  switch (f.operator) {
    case 'eq':
      return `${name} is ${single}`;
    case 'neq':
      return `${name} is not ${single}`;
    case 'contains':
      return `${name} includes ${single}`;
    case 'in':
      return `${name} is ${listText(f.field, Array.isArray(value) ? value : [])}`;
    case 'lt':
      return `${name} is below ${single}`;
    case 'lte':
      return `${name} is ${single} or below`;
    case 'gt':
      return `${name} is above ${single}`;
    case 'gte':
      return `${name} is ${single} or above`;
    case 'isEmpty':
      return `${name} is not set`;
    case 'isNotEmpty':
      return `${name} is set`;
  }
}

/** The conditions that say what kind of thing is listed (systems, platforms, one element type, one finding) rather than which of them. */
function subjectOf(spec: ReportSpec): { noun: string; rest: readonly ReportFilter[] } {
  let noun = SOURCE_NOUN[spec.source];
  const rest: ReportFilter[] = [];
  for (const f of spec.filters) {
    const v = f.value;
    if (spec.source === 'portfolio' && f.field === 'elementType' && f.operator === 'neq' && v === 'container') {
      noun = 'systems';
    } else if (spec.source === 'portfolio' && f.field === 'kind' && f.operator === 'eq' && typeof v === 'string') {
      noun = plural(valueText('kind', v).toLowerCase());
    } else if (spec.source === 'elements' && f.field === 'type' && f.operator === 'eq' && typeof v === 'string') {
      noun = plural(reportValueLabel('type', v).toLowerCase());
    } else if (spec.source === 'findings' && f.field === 'findingKey' && f.operator === 'eq' && typeof v === 'string') {
      const option = FINDING_FILTER_OPTIONS.find((o) => o.value === v);
      noun = option === undefined ? noun : lowerFirst(option.label);
    } else {
      rest.push(f);
    }
  }
  return { noun, rest };
}

/**
 * One plain sentence saying what a report shows, in the words the rest of the
 * app uses for fields and values: "Table of systems that cost a lot and fit
 * poorly", "Bar chart of systems by run cost, split by fit". Derived from the
 * spec each time — nothing stored.
 */
export function specSummary(spec: ReportSpec): string {
  const { noun, rest } = subjectOf(spec);
  const phrases: string[] = [];
  const wheres: string[] = [];
  for (const f of rest) {
    const phrase = f.field === 'signalKeys' && f.operator === 'contains' ? signalPhrase(f.value) : null;
    if (phrase !== null) phrases.push(phrase);
    else if (f.operator === 'isEmpty' && f.field !== 'signalKeys') phrases.push(`with no ${fieldWords(f.field)}`);
    else wheres.push(whereClause(f));
  }
  const what = [noun, ...phrases].join(' ') + (wheres.length === 0 ? '' : ` where ${wheres.join(' and ')}`);
  const p = spec.presentation;
  const group = spec.groupBy === undefined ? '' : ` by ${fieldWords(spec.groupBy)}`;
  const split = spec.groupBy === undefined || spec.splitBy === undefined ? '' : `, split by ${fieldWords(spec.splitBy)}`;
  switch (p.kind) {
    case 'table':
      return p.limit === undefined ? `Table of ${what}` : `Table of the top ${String(p.limit)} ${what}`;
    case 'count':
      return `Number of ${what}`;
    case 'barByField':
      return `Bar chart of ${what}${group}${split}`;
    case 'donut':
      return `Donut chart of ${what}${group}`;
  }
}

/** Case-insensitive match of the search text against a report's name, description and summary. */
export function matchesSearch(
  haystack: readonly string[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return haystack.some((h) => h.toLowerCase().includes(q));
}

export function sortSavedReports<
  T extends Pick<SavedReportRow, "name" | "updated_at" | "id">,
>(rows: readonly T[], key: SavedReportSortKey): T[] {
  return [...rows].sort((a, b) => {
    if (key === "name")
      return (
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.id.localeCompare(b.id)
      );
    return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
  });
}
