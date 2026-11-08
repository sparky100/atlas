import { describe, expect, it } from "vitest";
import type { ReportSpec } from "../../contracts/reportSpec";
import {
  matchesSearch,
  sortSavedReports,
  sourceLabel,
  specSummary,
} from "./savedReportList";

const base: ReportSpec = {
  specVersion: 1,
  source: "portfolio",
  filters: [],
  columns: [],
  sort: [],
  presentation: { kind: "table" },
};

describe("specSummary", () => {
  it("says no filters for an unfiltered table", () => {
    expect(specSummary(base)).toBe("Table · no filters");
  });
  it("lists filters and the chart grouping", () => {
    const spec: ReportSpec = {
      ...base,
      filters: [
        { field: "disposition", operator: "eq", value: "Eliminate" },
        { field: "runCost", operator: "gt", value: 1000000 },
        { field: "owner", operator: "isEmpty", value: null },
      ],
      groupBy: "criticality",
      splitBy: "disposition",
      presentation: { kind: "barByField" },
    };
    expect(specSummary(spec)).toBe(
      "Bar chart by criticality, split by disposition · disposition is Eliminate; runCost > 1000000; owner is empty",
    );
  });
  it("mentions the row limit", () => {
    expect(
      specSummary({ ...base, presentation: { kind: "table", limit: 5 } }),
    ).toBe("Table, top 5 · no filters");
  });
});

describe("sourceLabel", () => {
  it("uses plain words", () => {
    expect(sourceLabel("portfolio")).toBe("Portfolio");
  });
});

describe("matchesSearch", () => {
  it("matches any field case-insensitively and an empty query matches all", () => {
    expect(
      matchesSearch(["Costly, poor fit", "Table · no filters"], "POOR"),
    ).toBe(true);
    expect(matchesSearch(["Costly, poor fit"], "migrate")).toBe(false);
    expect(matchesSearch(["x"], "  ")).toBe(true);
  });
});

describe("sortSavedReports", () => {
  const rows = [
    { id: "a", name: "beta", updated_at: "2026-01-02T00:00:00Z" },
    { id: "b", name: "Alpha", updated_at: "2026-01-03T00:00:00Z" },
    { id: "c", name: "gamma", updated_at: "2026-01-01T00:00:00Z" },
  ];
  it("sorts by name ignoring case", () => {
    expect(sortSavedReports(rows, "name").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("sorts newest first and does not mutate", () => {
    expect(sortSavedReports(rows, "updated").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(rows[0]?.id).toBe("a");
  });
});
