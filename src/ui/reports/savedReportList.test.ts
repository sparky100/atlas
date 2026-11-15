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
  it("says what an unfiltered table lists", () => {
    expect(specSummary(base)).toBe("Table of systems");
  });
  it("turns the costly, poor fit signal into words", () => {
    expect(
      specSummary({
        ...base,
        filters: [
          { field: "elementType", operator: "neq", value: "container" },
          { field: "signalKeys", operator: "contains", value: "|costly_poor_fit|" },
        ],
      }),
    ).toBe("Table of systems that cost a lot and fit poorly");
  });
  it("uses the app's labels for fields and values, with no keys or pipes", () => {
    const s = specSummary({
      ...base,
      filters: [
        { field: "elementType", operator: "neq", value: "container" },
        { field: "cost", operator: "in", value: ["1m_5m", "over_5m"] },
        { field: "disposition", operator: "eq", value: "eliminate" },
        { field: "owner", operator: "isEmpty", value: null },
      ],
      groupBy: "criticality",
      splitBy: "fit",
      presentation: { kind: "barByField" },
    });
    expect(s).toBe(
      "Bar chart of systems with no owner where run cost is £1m–£5m or over £5m and planned action is switch off by criticality, split by fit",
    );
    expect(s).not.toMatch(/[|_]|elementType|signalKeys/);
  });
  it("names a finding by its own title", () => {
    expect(
      specSummary({
        ...base,
        source: "findings",
        filters: [{ field: "findingKey", operator: "eq", value: "critical-no-business-owner" }],
      }),
    ).toBe("Table of critical systems with no business owner");
  });
  it("mentions the row limit and counts", () => {
    expect(
      specSummary({ ...base, presentation: { kind: "table", limit: 5 } }),
    ).toBe("Table of the top 5 systems");
    expect(specSummary({ ...base, presentation: { kind: "count" } })).toBe(
      "Number of systems",
    );
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
      matchesSearch(["Costly, poor fit", "Table of systems"], "POOR"),
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
