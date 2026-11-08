/**
 * Pure helpers for the saved-reports table on the Reports hub: plain-language
 * labels for a report's source and shape, and search + sort over the rows.
 * No I/O, nothing stored — a report's summary is derived from its spec.
 */
import type {
  ReportFilter,
  ReportSource,
  ReportSpec,
} from "../../contracts/reportSpec";
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

const OPERATOR_TEXT: Record<ReportFilter["operator"], string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  in: "is one of",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  isEmpty: "is empty",
  isNotEmpty: "is set",
};

function filterText(f: ReportFilter): string {
  const value = Array.isArray(f.value)
    ? f.value.join(", ")
    : f.value === null
      ? ""
      : String(f.value);
  return `${f.field} ${OPERATOR_TEXT[f.operator]}${value === "" ? "" : ` ${value}`}`;
}

function presentationText(spec: ReportSpec): string {
  switch (spec.presentation.kind) {
    case "table":
      return spec.presentation.limit === undefined
        ? "Table"
        : `Table, top ${String(spec.presentation.limit)}`;
    case "count":
      return "Count";
    case "barByField":
      return spec.groupBy === undefined
        ? "Bar chart"
        : `Bar chart by ${spec.groupBy}${spec.splitBy === undefined ? "" : `, split by ${spec.splitBy}`}`;
    case "donut":
      return spec.groupBy === undefined ? "Donut" : `Donut by ${spec.groupBy}`;
  }
}

/** One line saying what a report asks, e.g. "Table · disposition is Eliminate; run cost > 1000000". */
export function specSummary(spec: ReportSpec): string {
  const filters =
    spec.filters.length === 0
      ? "no filters"
      : spec.filters.map(filterText).join("; ");
  return `${presentationText(spec)} · ${filters}`;
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
